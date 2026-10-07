import { Router } from 'express';
import { logger } from '../utils/logger';
import { newApiBridge } from './auth';
import { validateSession, revokeSession } from './auth';
import { auditRepo, redis } from './auth';
import { verifyGuildMembership } from './auth';
import { rateLimiter } from '../services/rateLimiter';
const router = Router();
const SESSION_COOKIE = 'discord_gate_session';
const GUILD_CHECK_TTL = 300; // 5 minutes
/**
 * GET /auth/verify
 *
 * Called by Caddy forward_auth before every proxied request.
 * Returns 200 + identity headers if session is valid.
 * Returns 401 if session is missing or expired.
 * Returns 429 if rate limit exceeded.
 * Caddy is configured to redirect 401 to /auth/discord.
 */
router.get('/verify', async (req, res) => {
    try {
        // Step 1: Extract session token from cookie or Authorization header
        const token = req.cookies?.[SESSION_COOKIE] || req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            logger.debug('No session token in verify request');
            return res.status(401).json({ error: 'No session' });
        }
        // Step 2: Validate session in Redis (fast path)
        const session = await validateSession(token);
        if (!session) {
            logger.debug('Invalid session token');
            return res.status(401).json({ error: 'Invalid session' });
        }
        // Step 3: Check guild membership (cached in Redis for 5 minutes)
        const cacheKey = `guild_check:${session.discordId}`;
        const cached = await redis.get(cacheKey);
        if (!cached) {
            const { isMember } = await verifyGuildMembership(session.discordId);
            if (!isMember) {
                logger.info('Guild membership lost, revoking session', { discordId: session.discordId });
                await revokeSession(token);
                await newApiBridge.fullRevoke(session.discordId, 'guild_membership_lost');
                await auditRepo.log({
                    eventType: 'MEMBER_LEFT_GUILD',
                    discordId: session.discordId,
                    metadata: { reason: 'guild_membership_lost' },
                });
                return res.status(401).json({ error: 'Guild membership lost' });
            }
            await redis.setEx(cacheKey, GUILD_CHECK_TTL, '1');
        }
        // Step 4: CHECK RATE LIMIT — after session validation, not before
        // Unauthenticated requests never reach the rate limiter
        const rateResult = await rateLimiter.check(session.discordId);
        // Set rate limit headers on EVERY response (success or 429)
        // Clients can use these to self-throttle before hitting the limit
        res.setHeader('X-RateLimit-Limit', String(rateResult.limit));
        res.setHeader('X-RateLimit-Remaining', String(rateResult.remaining));
        res.setHeader('X-RateLimit-Reset', String(rateResult.resetInSeconds));
        if (!rateResult.allowed) {
            // Set Retry-After header for 429 response
            res.setHeader('Retry-After', String(rateResult.resetInSeconds));
            logger.warn('Rate limit exceeded for Discord user', {
                discordId: session.discordId,
                count: rateResult.count,
                limit: rateResult.limit,
                resetInSeconds: rateResult.resetInSeconds,
            });
            return res.status(429).json({
                error: 'Rate limit exceeded',
                code: 'RATE_LIMITED',
                limit: rateResult.limit,
                windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
                retryAfter: rateResult.resetInSeconds,
                message: `You have exceeded ${rateResult.limit} requests per minute. Try again in ${rateResult.resetInSeconds}s.`,
            });
        }
        // Step 5: Return 200 with Discord identity headers
        // Caddy copies these headers to the New API request
        // New API can read X-Discord-User-ID to log AI usage
        res.setHeader('X-Discord-User-ID', session.discordId);
        res.setHeader('X-Discord-Username', session.discordUsername);
        res.status(200).json({ ok: true });
    }
    catch (error) {
        logger.error('Verify endpoint error', { error });
        return res.status(500).json({ error: 'Internal error' });
    }
});
const RATE_LIMIT_WINDOW_SECONDS = parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS ?? '60', 10);
export default router;
//# sourceMappingURL=verify.js.map