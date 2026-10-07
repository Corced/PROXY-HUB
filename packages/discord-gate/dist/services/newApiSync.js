/**
 * NewApiSync - Provisions New API accounts for Discord users
 * Called when a Discord member successfully logs in for the first time.
 * Creates or activates their New API account with MEMBER-level access.
 * Never creates ADMIN accounts through this flow.
 */
import axios from 'axios';
import { logger } from '../utils/logger.js';
export class NewApiSync {
    static instance;
    client;
    baseUrl;
    adminToken;
    defaultGroup;
    constructor(config) {
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
    static getInstance(config) {
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
    async findUserByDiscordId(discordId) {
        try {
            const response = await this.client.get('/api/admin/users', {
                params: { keyword: discordId },
            });
            const users = response.data.data?.items || response.data.data || [];
            const user = users.find((u) => u.discord_id === discordId);
            if (user) {
                logger.debug('Found existing New API user by Discord ID', { discordId, userId: user.id });
                return user;
            }
            // Fallback: full list scan
            const allResponse = await this.client.get('/api/admin/users');
            const allUsers = allResponse.data.data?.items || allResponse.data.data || [];
            const exactMatch = allUsers.find((u) => u.discord_id === discordId);
            if (exactMatch) {
                logger.debug('Found New API user by Discord ID (fallback)', { discordId, userId: exactMatch.id });
                return exactMatch;
            }
            return null;
        }
        catch (error) {
            logger.error('Failed to find user by Discord ID', { discordId, error });
            return null;
        }
    }
    /**
     * Create a new New API user for a Discord member
     * Called on first login
     */
    async createUser(discordUser) {
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
        const newUser = response.data.data;
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
    async enableUser(userId) {
        await this.client.put(`/api/admin/users/${userId}`, {
            action: 'enable',
        });
        logger.info('Re-enabled existing New API user', { userId });
    }
    /**
     * Update user's group (for role changes via slash commands)
     */
    async setUserGroup(newApiUserId, group) {
        try {
            await this.client.put(`/api/admin/users/${newApiUserId}`, {
                group,
            });
            logger.info('Updated New API user group', { userId: newApiUserId, group });
        }
        catch (error) {
            logger.error('Failed to update New API user group', { userId: newApiUserId, group, error });
            throw error;
        }
    }
    /**
     * Provision or activate a New API user for a Discord member
     * Called on successful Discord OAuth login
     */
    async provisionUser(discordUser) {
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
                const updatedUser = response.data.data;
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
export function initNewApiSync(config) {
    return NewApiSync.getInstance(config);
}
//# sourceMappingURL=newApiSync.js.map