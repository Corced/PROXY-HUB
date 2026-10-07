/**
 * NewApiSync - Provisions New API accounts for Discord users
 * Called when a Discord member successfully logs in for the first time.
 * Creates or activates their New API account with MEMBER-level access.
 * Never creates ADMIN accounts through this flow.
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger.js';

interface AuthConfig {
  NEW_API_INTERNAL_URL: string;
  NEW_API_ADMIN_TOKEN: string;
  NEW_API_DEFAULT_GROUP: string;
}

export interface NewApiUser {
  id: number;
  username: string;
  display_name?: string;
  discord_id?: string;
  email?: string;
  role: number;
  status: number;
  group?: string;
}

export interface DiscordUser {
  id: string;
  username: string;
  discriminator?: string;
  avatar?: string;
  global_name?: string;
}

export class NewApiSync {
  private static instance: NewApiSync;
  private client: AxiosInstance;
  private baseUrl: string;
  private adminToken: string;
  private defaultGroup: string;

  private constructor(config: AuthConfig) {
    this.baseUrl = config.NEW_API_INTERNAL_URL;
    this.adminToken = config.NEW_API_ADMIN_TOKEN;
    this.defaultGroup = config.NEW_API_DEFAULT_GROUP || 'default';

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        Authorization: `Bearer ${this.adminToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  static getInstance(config?: AuthConfig): NewApiSync {
    if (!NewApiSync.instance && config) {
      NewApiSync.instance = new NewApiSync(config);
    }
    if (!NewApiSync.instance) {
      throw new Error('NewApiSync not initialized. Call getInstance(config) first.');
    }
    return NewApiSync.instance;
  }

  /**
   * Find New API user by Discord ID
   * Returns user if exists (enabled or disabled)
   */
  private async findUserByDiscordId(discordId: string): Promise<NewApiUser | null> {
    try {
      const response = await this.client.get('/api/admin/users', {
        params: { keyword: discordId },
      });

      const users: NewApiUser[] = response.data.data?.items || response.data.data || [];
      const user = users.find((u) => u.discord_id === discordId);

      if (user) {
        logger.debug('Found existing New API user by Discord ID', { discordId, userId: user.id });
        return user;
      }

      // Fallback: full list scan
      const allResponse = await this.client.get('/api/admin/users');
      const allUsers: NewApiUser[] = allResponse.data.data?.items || allResponse.data.data || [];
      const exactMatch = allUsers.find((u) => u.discord_id === discordId);

      if (exactMatch) {
        logger.debug('Found New API user by Discord ID (fallback)', { discordId, userId: exactMatch.id });
        return exactMatch;
      }

      return null;
    } catch (error) {
      logger.error('Failed to find user by Discord ID', { discordId, error });
      return null;
    }
  }

  /**
   * Create a new New API user for a Discord member
   * Called on first login
   */
  private async createUser(discordUser: DiscordUser): Promise<NewApiUser> {
    const username = discordUser.global_name || discordUser.username;
    const displayName = username;

    const response = await this.client.post('/api/admin/users', {
      username,
      display_name: displayName,
      discord_id: discordUser.id,
      group: this.defaultGroup,
      role: 1, // common user (not admin)
      status: 1, // enabled
    });

    const newUser: NewApiUser = response.data.data;
    logger.info('Created New API user for Discord member', {
      discordId: discordUser.id,
      newApiUserId: newUser.id,
      group: this.defaultGroup,
    });

    return newUser;
  }

  /**
   * Re-enable a disabled user
   */
  private async enableUser(userId: number): Promise<void> {
    await this.client.put(`/api/admin/users/${userId}`, {
      action: 'enable',
    });
    logger.info('Re-enabled existing New API user', { userId });
  }

  /**
   * Update user's group (for role changes via slash commands)
   */
  async setUserGroup(newApiUserId: number, group: string): Promise<void> {
    try {
      await this.client.put(`/api/admin/users/${newApiUserId}`, {
        group,
      });
      logger.info('Updated New API user group', { userId: newApiUserId, group });
    } catch (error) {
      logger.error('Failed to update New API user group', { userId: newApiUserId, group, error });
      throw error;
    }
  }

  /**
   * Provision or activate a New API user for a Discord member
   * Called on successful Discord OAuth login
   */
  async provisionUser(discordUser: DiscordUser): Promise<NewApiUser> {
    logger.info('Provisioning New API user for Discord member', { discordId: discordUser.id });

    // Check if user already exists
    const existingUser = await this.findUserByDiscordId(discordUser.id);

    if (existingUser) {
      // User exists - if disabled, re-enable
      if (existingUser.status === 0) {
        await this.enableUser(existingUser.id);
        logger.info('Re-enabled disabled New API user', { userId: existingUser.id });

        // Refresh user data
        const response = await this.client.get(`/api/admin/users/${existingUser.id}`);
        const updatedUser: NewApiUser = response.data.data;
        return updatedUser;
      }

      // Already active
      logger.debug('New API user already active', { userId: existingUser.id });
      return existingUser;
    }

    // Create new user
    return await this.createUser(discordUser);
  }
}

/**
 * Initialize the sync singleton from auth config
 * Call once at application startup
 */
export function initNewApiSync(config: AuthConfig): NewApiSync {
  return NewApiSync.getInstance(config);
}