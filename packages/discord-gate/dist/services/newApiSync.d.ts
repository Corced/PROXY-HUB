/**
 * NewApiSync - Provisions New API accounts for Discord users
 * Called when a Discord member successfully logs in for the first time.
 * Creates or activates their New API account with MEMBER-level access.
 * Never creates ADMIN accounts through this flow.
 */
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
export declare class NewApiSync {
    private static instance;
    private client;
    private baseUrl;
    private adminToken;
    private defaultGroup;
    private constructor();
    static getInstance(config?: AuthConfig): NewApiSync;
    /**
     * Find New API user by Discord ID
     * Returns user if exists (enabled or disabled)
     */
    private findUserByDiscordId;
    /**
     * Create a new New API user for a Discord member
     * Called on first login
     */
    private createUser;
    /**
     * Re-enable a disabled user
     */
    private enableUser;
    /**
     * Update user's group (for role changes via slash commands)
     */
    setUserGroup(newApiUserId: number, group: string): Promise<void>;
    /**
     * Provision or activate a New API user for a Discord member
     * Called on successful Discord OAuth login
     */
    provisionUser(discordUser: DiscordUser): Promise<NewApiUser>;
}
/**
 * Initialize the sync singleton from auth config
 * Call once at application startup
 */
export declare function initNewApiSync(config: AuthConfig): NewApiSync;
export {};
//# sourceMappingURL=newApiSync.d.ts.map