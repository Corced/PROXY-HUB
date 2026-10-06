/**
 * NewApiBridge - Bridge between DiscordGate revocation events and New API
 * Called when a Discord member leaves or is banned to ensure ALL their access
 * is revoked: both sessions (DiscordGate) AND API keys (New API).
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../utils/logger.js';

interface AuthConfig {
  NEW_API_INTERNAL_URL: string;
  NEW_API_ADMIN_TOKEN: string;
}

export interface NewApiUser {
  id: number;
  username: string;
  discord_id?: string;
  email?: string;
  role: number;
  status: number;
  group?: string;
}

export interface RevokeResult {
  found: boolean;
  keysRevoked: number;
}

export interface NewApiToken {
  id: number;
  user_id: number;
  key: string;
  name: string;
  status: number;
  expired_time: number;
}

export class NewApiBridge {
  private static instance: NewApiBridge;
  private client: AxiosInstance;
  private baseUrl: string;
  private adminToken: string;

  private constructor(config: AuthConfig) {
    this.baseUrl = config.NEW_API_INTERNAL_URL;
    this.adminToken = config.NEW_API_ADMIN_TOKEN;

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        Authorization: `Bearer ${this.adminToken}`,
        'Content-Type': 'application/json',
      },
    });

    // Response interceptor for logging errors
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response) {
          logger.error('New API request failed', {
            status: error.response.status,
            url: error.config?.url,
            data: error.response.data,
          });
        } else {
          logger.error('New API network error', { message: error.message });
        }
        return Promise.reject(error);
      }
    );
  }

  static getInstance(config?: AuthConfig): NewApiBridge {
    if (!NewApiBridge.instance && config) {
      NewApiBridge.instance = new NewApiBridge(config);
    }
    if (!NewApiBridge.instance) {
      throw new Error('NewApiBridge not initialized. Call getInstance(config) first.');
    }
    return NewApiBridge.instance;
  }

  /**
   * Find New API user by Discord ID
   * Uses admin endpoint to list users and filter by discord_id
   */
  async findUserByDiscordId(discordId: string): Promise<NewApiUser | null> {
    try {
      // Try to get user list and filter by discord_id
      // Using admin endpoint with search/query parameters
      const response = await this.client.get('/api/admin/users', {
        params: {
          keyword: discordId,
        },
      });

      const users: NewApiUser[] = response.data.data?.items || response.data.data || [];
      const user = users.find((u) => u.discord_id === discordId);

      if (user) {
        logger.debug('Found New API user by Discord ID', { discordId, userId: user.id });
        return user;
      }

      // Fallback: try exact match via user list
      const allResponse = await this.client.get('/api/admin/users');
      const allUsers: NewApiUser[] = allResponse.data.data?.items || allResponse.data.data || [];
      const exactMatch = allUsers.find((u) => u.discord_id === discordId);

      if (exactMatch) {
        logger.debug('Found New API user by Discord ID (fallback)', { discordId, userId: exactMatch.id });
        return exactMatch;
      }

      logger.warn('No New API user found for Discord ID', { discordId });
      return null;
    } catch (error) {
      logger.error('Failed to find user by Discord ID', { discordId, error });
      return null;
    }
  }

  /**
   * Revoke ALL API keys for a user by their New API user ID
   * Uses bulk delete endpoint for efficiency
   */
  async revokeAllUserApiKeys(newApiUserId: number): Promise<number> {
    try {
      // First, list all tokens for the user
      const listResponse = await this.client.get(`/api/user/${newApiUserId}/tokens`);
      const tokens: NewApiToken[] = listResponse.data.data?.items || listResponse.data.data || [];

      if (tokens.length === 0) {
        logger.info('No API keys to revoke for user', { userId: newApiUserId });
        return 0;
      }

      const tokenIds = tokens.map((t) => t.id);
      logger.info(`Revoking ${tokenIds.length} API keys for user`, { userId: newApiUserId, tokenIds });

      // Bulk delete all tokens
      const deleteResponse = await this.client.post('/api/user/tokens/batch', {
        ids: tokenIds,
      });

      const revokedCount = deleteResponse.data.data || tokenIds.length;
      logger.info('Bulk API key revocation complete', { userId: newApiUserId, revokedCount });

      return revokedCount;
    } catch (error) {
      logger.error('Failed to bulk revoke API keys, attempting individual deletion', { userId: newApiUserId, error });

      // Fallback: try individual deletion
      return await this.revokeKeysIndividually(newApiUserId);
    }
  }

  /**
   * Fallback: revoke keys one by one if bulk fails
   * Never throws - logs each failure but continues
   */
  private async revokeKeysIndividually(newApiUserId: number): Promise<number> {
    let revokedCount = 0;

    try {
      const listResponse = await this.client.get(`/api/user/${newApiUserId}/tokens`);
      const tokens: NewApiToken[] = listResponse.data.data?.items || listResponse.data.data || [];

      for (const token of tokens) {
        try {
          await this.client.delete(`/api/user/tokens/${token.id}`);
          revokedCount++;
          logger.debug('Revoked API key', { userId: newApiUserId, tokenId: token.id, tokenName: token.name });
        } catch (err) {
          logger.error('Failed to revoke individual API key', {
            userId: newApiUserId,
            tokenId: token.id,
            error: err,
          });
          // Continue with other keys - never abort
        }
      }

      logger.info('Individual API key revocation complete', { userId: newApiUserId, revokedCount });
      return revokedCount;
    } catch (error) {
      logger.error('Failed to list tokens for individual revocation', { userId: newApiUserId, error });
      return 0;
    }
  }

  /**
   * Disable a New API user account
   * Prevents re-login even if valid session token still exists
   */
  async disableUser(newApiUserId: number): Promise<void> {
    try {
      await this.client.put(`/api/admin/users/${newApiUserId}`, {
        action: 'disable',
      });
      logger.info('New API user disabled', { userId: newApiUserId });
    } catch (error) {
      logger.error('Failed to disable New API user', { userId: newApiUserId, error });
      throw error;
    }
  }

  /**
   * Complete revocation: find user by Discord ID, revoke all keys, disable account
   * Called by DiscordGate when a guild member leaves or is banned
   */
  async fullRevoke(discordId: string, reason: string): Promise<RevokeResult> {
    logger.info('Starting full revocation for Discord user', { discordId, reason });

    const user = await this.findUserByDiscordId(discordId);
    if (!user) {
      logger.warn('No New API user found for Discord ID during revocation', { discordId });
      return { found: false, keysRevoked: 0 };
    }

    const keysRevoked = await this.revokeAllUserApiKeys(user.id);
    await this.disableUser(user.id);

    logger.info('Full revocation complete', { discordId, newApiUserId: user.id, keysRevoked, reason });
    return { found: true, keysRevoked };
  }
}

/**
 * Initialize the bridge singleton from auth config
 * Call once at application startup
 */
export function initNewApiBridge(config: AuthConfig): NewApiBridge {
  return NewApiBridge.getInstance(config);
}