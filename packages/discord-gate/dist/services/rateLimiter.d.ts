export interface RateLimitResult {
    allowed: boolean;
    count: number;
    limit: number;
    remaining: number;
    resetInSeconds: number;
}
export declare class RateLimiter {
    private redis;
    constructor(redis?: import("ioredis").default<"legacy">);
    /**
     * Check and increment rate limit for a Discord user.
     * Uses a fixed window counter in Redis.
     * Key expires after RATE_LIMIT_WINDOW_SECONDS automatically.
     *
     * @param discordUserId - Discord snowflake ID of the user
     * @returns RateLimitResult with allowed flag and metadata
     */
    check(discordUserId: string): Promise<RateLimitResult>;
    /**
     * Reset the rate limit counter for a specific user.
     * Used by moderators via /resetratelimit slash command.
     */
    reset(discordUserId: string): Promise<void>;
    /**
     * Get current usage without incrementing.
     * Used by /checkratelimit slash command.
     */
    getUsage(discordUserId: string): Promise<{
        count: number;
        resetInSeconds: number;
    }>;
}
export declare const rateLimiter: RateLimiter;
//# sourceMappingURL=rateLimiter.d.ts.map