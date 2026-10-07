import { redisClient } from '../db/redis';
import { logger } from '../utils/logger';
// Rate limit configuration — can be overridden via env vars
const RATE_LIMIT_REQUESTS = parseInt(process.env.RATE_LIMIT_RPM ?? '15', 10);
const RATE_LIMIT_WINDOW_SECONDS = parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS ?? '60', 10);
export class RateLimiter {
    redis;
    constructor(redis = redisClient) {
        this.redis = redis;
    }
    /**
     * Check and increment rate limit for a Discord user.
     * Uses a fixed window counter in Redis.
     * Key expires after RATE_LIMIT_WINDOW_SECONDS automatically.
     *
     * @param discordUserId - Discord snowflake ID of the user
     * @returns RateLimitResult with allowed flag and metadata
     */
    async check(discordUserId) {
        // Key format: rate:15rpm:{discordUserId}
        // One key per user — expires after window seconds
        const key = `rate:${RATE_LIMIT_REQUESTS}rpm:${discordUserId}`;
        try {
            // Atomic increment — returns new count after increment
            const count = await this.redis.incr(key);
            // On first request in window: set the TTL
            // (INCR on non-existent key creates it with value 1)
            if (count === 1) {
                await this.redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
            }
            // Get remaining TTL so we can tell client when window resets
            const ttl = await this.redis.ttl(key);
            const resetInSeconds = ttl > 0 ? ttl : RATE_LIMIT_WINDOW_SECONDS;
            const allowed = count <= RATE_LIMIT_REQUESTS;
            const remaining = Math.max(0, RATE_LIMIT_REQUESTS - count);
            if (!allowed) {
                logger.warn('Rate limit exceeded', {
                    discordUserId,
                    count,
                    limit: RATE_LIMIT_REQUESTS,
                    resetInSeconds,
                });
            }
            return {
                allowed,
                count,
                limit: RATE_LIMIT_REQUESTS,
                remaining,
                resetInSeconds,
            };
        }
        catch (err) {
            // If Redis is down, fail OPEN (allow request) and log
            // Failing closed here would block ALL users if Redis has a blip
            logger.error('Rate limiter Redis error — failing open', { err, discordUserId });
            return {
                allowed: true,
                count: 0,
                limit: RATE_LIMIT_REQUESTS,
                remaining: RATE_LIMIT_REQUESTS,
                resetInSeconds: RATE_LIMIT_WINDOW_SECONDS,
            };
        }
    }
    /**
     * Reset the rate limit counter for a specific user.
     * Used by moderators via /resetratelimit slash command.
     */
    async reset(discordUserId) {
        const key = `rate:${RATE_LIMIT_REQUESTS}rpm:${discordUserId}`;
        await this.redis.del(key);
        logger.info('Rate limit reset', { discordUserId });
    }
    /**
     * Get current usage without incrementing.
     * Used by /checkratelimit slash command.
     */
    async getUsage(discordUserId) {
        const key = `rate:${RATE_LIMIT_REQUESTS}rpm:${discordUserId}`;
        const [countStr, ttl] = await Promise.all([
            this.redis.get(key),
            this.redis.ttl(key),
        ]);
        return {
            count: countStr ? parseInt(countStr, 10) : 0,
            resetInSeconds: ttl > 0 ? ttl : 0,
        };
    }
}
// Singleton export — shares the same Redis connection as the rest
export const rateLimiter = new RateLimiter();
//# sourceMappingURL=rateLimiter.js.map