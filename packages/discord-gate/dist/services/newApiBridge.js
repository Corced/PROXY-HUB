/**
 * NewApiBridge - Bridge between DiscordGate revocation events and New API
 * Called when a Discord member leaves or is banned to ensure ALL their access
 * is revoked: both sessions (DiscordGate) AND API keys (New API).
 */
import axios from 'axios';
import { logger } from '../utils/logger.js';
import { auditRepo } from '../routes/auth.js';
export class NewApiBridge {
    static instance;
    client;
    baseUrl;
    adminToken;
    constructor(config) {
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
        this.client.interceptors.response.use((response) => response, (error) => {
            if (error.response) {
                logger.error('New API request failed', {
                    status: error.response.status,
                    url: error.config?.url,
                    data: error.response.data,
                });
            }
            else {
                logger.error('New API network error', { message: error.message });
            }
            return Promise.reject(error);
        });
    }
    static getInstance(config) {
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
    async findUserByDiscordId(discordId) {
        try {
            // Try to get user list and filter by discord_id
            // Using admin endpoint with search/query parameters
            const response = await this.client.get('/api/admin/users', {
                params: {
                    keyword: discordId,
                },
            });
            const users = response.data.data?.items || response.data.data || [];
            const user = users.find((u) => u.discord_id === discordId);
            if (user) {
                logger.debug('Found New API user by Discord ID', { discordId, userId: user.id });
                return user;
            }
            // Fallback: try exact match via user list
            const allResponse = await this.client.get('/api/admin/users');
            const allUsers = allResponse.data.data?.items || allResponse.data.data || [];
            const exactMatch = allUsers.find((u) => u.discord_id === discordId);
            if (exactMatch) {
                logger.debug('Found New API user by Discord ID (fallback)', { discordId, userId: exactMatch.id });
                return exactMatch;
            }
            logger.warn('No New API user found for Discord ID', { discordId });
            return null;
        }
        catch (error) {
            logger.error('Failed to find user by Discord ID', { discordId, error });
            return null;
        }
    }
    /**
     * Revoke ALL API keys for a user by their New API user ID
     * Uses bulk delete endpoint for efficiency
     */
    async revokeAllUserApiKeys(newApiUserId) {
        try {
            // First, list all tokens for the user
            const listResponse = await this.client.get(`/api/user/${newApiUserId}/tokens`);
            const tokens = listResponse.data.data?.items || listResponse.data.data || [];
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
            // Log each revoked key as audit event
            for (const token of tokens) {
                await auditRepo.log({
                    eventType: 'API_KEY_REVOKED',
                    discordId: undefined,
                    newApiUserId: String(newApiUserId),
                    metadata: { tokenId: token.id, tokenName: token.name, revokedVia: 'bulk' },
                });
            }
            return revokedCount;
        }
        catch (error) {
            logger.error('Failed to bulk revoke API keys, attempting individual deletion', { userId: newApiUserId, error });
            // Fallback: try individual deletion
            return await this.revokeKeysIndividually(newApiUserId);
        }
    }
    /**
     * Fallback: revoke keys one by one if bulk fails
     * Never throws - logs each failure but continues
     */
    async revokeKeysIndividually(newApiUserId) {
        let revokedCount = 0;
        try {
            const listResponse = await this.client.get(`/api/user/${newApiUserId}/tokens`);
            const tokens = listResponse.data.data?.items || listResponse.data.data || [];
            for (const token of tokens) {
                try {
                    await this.client.delete(`/api/user/tokens/${token.id}`);
                    revokedCount++;
                    logger.debug('Revoked API key', { userId: newApiUserId, tokenId: token.id, tokenName: token.name });
                    // Log each individually revoked key
                    await auditRepo.log({
                        eventType: 'API_KEY_REVOKED',
                        discordId: undefined,
                        newApiUserId: String(newApiUserId),
                        metadata: { tokenId: token.id, tokenName: token.name, revokedVia: 'individual' },
                    });
                }
                catch (err) {
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
        }
        catch (error) {
            logger.error('Failed to list tokens for individual revocation', { userId: newApiUserId, error });
            return 0;
        }
    }
    /**
     * Disable a New API user account
     * Prevents re-login even if valid session token still exists
     */
    async disableUser(newApiUserId) {
        try {
            await this.client.put(`/api/admin/users/${newApiUserId}`, {
                action: 'disable',
            });
            logger.info('New API user disabled', { userId: newApiUserId });
            // Log user disabled event
            await auditRepo.log({
                eventType: 'USER_DISABLED',
                discordId: undefined,
                newApiUserId: String(newApiUserId),
                metadata: { disabledVia: 'fullRevoke' },
            });
        }
        catch (error) {
            logger.error('Failed to disable New API user', { userId: newApiUserId, error });
            throw error;
        }
    }
    /**
     * Complete revocation: find user by Discord ID, revoke all keys, disable account
     * Called by DiscordGate when a guild member leaves or is banned
     */
    async fullRevoke(discordId, reason) {
        logger.info('Starting full revocation for Discord user', { discordId, reason });
        const user = await this.findUserByDiscordId(discordId);
        if (!user) {
            logger.warn('No New API user found for Discord ID during revocation', { discordId });
            return { found: false, keysRevoked: 0 };
        }
        const keysRevoked = await this.revokeAllUserApiKeys(user.id);
        await this.disableUser(user.id);
        // Log the full revocation as a summary event
        await auditRepo.log({
            eventType: 'FULL_REVOKE',
            discordId,
            newApiUserId: String(user.id),
            metadata: { reason, keysRevoked },
        });
        logger.info('Full revocation complete', { discordId, newApiUserId: user.id, keysRevoked, reason });
        return { found: true, keysRevoked };
    }
}
/**
 * Initialize the bridge singleton from auth config
 * Call once at application startup
 */
export function initNewApiBridge(config) {
    return NewApiBridge.getInstance(config);
}
// Export a lazy-initialized instance for bot commands
export const newApiBridge = {
    getInstance: () => NewApiBridge.getInstance(),
};
//# sourceMappingURL=newApiBridge.js.map