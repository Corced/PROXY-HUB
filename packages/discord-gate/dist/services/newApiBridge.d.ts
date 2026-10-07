/**
 * NewApiBridge - Bridge between DiscordGate revocation events and New API
 * Called when a Discord member leaves or is banned to ensure ALL their access
 * is revoked: both sessions (DiscordGate) AND API keys (New API).
 */
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
export declare class NewApiBridge {
    private static instance;
    private client;
    private baseUrl;
    private adminToken;
    private constructor();
    static getInstance(config?: AuthConfig): NewApiBridge;
    /**
     * Find New API user by Discord ID
     * Uses admin endpoint to list users and filter by discord_id
     */
    findUserByDiscordId(discordId: string): Promise<NewApiUser | null>;
    /**
     * Revoke ALL API keys for a user by their New API user ID
     * Uses bulk delete endpoint for efficiency
     */
    revokeAllUserApiKeys(newApiUserId: number): Promise<number>;
    /**
     * Fallback: revoke keys one by one if bulk fails
     * Never throws - logs each failure but continues
     */
    private revokeKeysIndividually;
    /**
     * Disable a New API user account
     * Prevents re-login even if valid session token still exists
     */
    disableUser(newApiUserId: number): Promise<void>;
    /**
     * Complete revocation: find user by Discord ID, revoke all keys, disable account
     * Called by DiscordGate when a guild member leaves or is banned
     */
    fullRevoke(discordId: string, reason: string): Promise<RevokeResult>;
}
/**
 * Initialize the bridge singleton from auth config
 * Call once at application startup
 */
export declare function initNewApiBridge(config: AuthConfig): NewApiBridge;
export {};
//# sourceMappingURL=newApiBridge.d.ts.map