import { Router, Request, Response, NextFunction } from 'express';
import { discordGateConfig } from '../config/discordGateConfig';
import { logger } from '../utils/logger';
import { newApiBridge } from './auth';
import { memberRepo, sessionRepo, auditRepo, redis } from './auth';
import { revokeAllMemberSessions } from './auth';
import { rateLimiter } from '../services/rateLimiter';

const router = Router();

const INTERNAL_SECRET_HEADER = 'x-internal-secret';

// Middleware to verify internal secret
function requireInternalSecret(req: Request, res: Response, next: NextFunction): void {
  const provided = req.headers[INTERNAL_SECRET_HEADER];
  const expected = discordGateConfig.BOT_INTERNAL_SECRET;

  if (!provided || provided !== expected) {
    logger.warn('Unauthorized internal API access attempt', {
      ip: req.ip,
      path: req.path,
    });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// Apply to all routes in this router
router.use(requireInternalSecret);

/**
 * POST /internal/revoke-member
 * Body: { discordId: string, reason: string }
 *
 * Called by external systems (Discord bot, admin panel) to revoke a member.
 */
router.post('/revoke-member', async (req: Request, res: Response) => {
  try {
    const { discordId, reason } = req.body;

    if (!discordId || !reason) {
      return res.status(400).json({ error: 'discordId and reason are required' });
    }

    // Find member
    const member = await memberRepo.findByDiscordId(discordId);
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    // Revoke all sessions
    const sessionsRevoked = await revokeAllMemberSessions(discordId);

    // Call New API bridge to revoke API keys and disable user
    const bridgeResult = await newApiBridge.fullRevoke(discordId, reason);
    const keysRevoked = bridgeResult.keysRevoked;

    // Update member status in DB
    await memberRepo.revokeMember(discordId, reason);

    // Clear guild membership cache
    await redis.del(`guild_check:${discordId}`);

    // Audit log
    await auditRepo.log({
      eventType: 'MANUAL_REVOKE',
      discordId,
      metadata: { reason, sessionsRevoked, keysRevoked },
    });

    logger.info('Member revoked via internal API', {
      discordId,
      sessionsRevoked,
      keysRevoked,
      reason,
    });

    res.json({
      success: true,
      sessionsRevoked,
      keysRevoked,
    });
  } catch (error) {
    logger.error('Internal revoke-member error', { error });
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * GET /internal/member/:discordId
 * Returns discord_gate_members record for this Discord ID
 */
router.get('/member/:discordId', async (req: Request, res: Response) => {
  try {
    const discordId = req.params.discordId as string;
    const member = await memberRepo.findByDiscordId(discordId);

    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    // Don't expose internal UUID
    const { id, ...safeMember } = member;
    res.json(safeMember);
  } catch (error) {
    logger.error('Internal member lookup error', { error });
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * GET /internal/ratelimit/:discordId
 * Get current rate limit usage for a Discord user
 * Does NOT increment the counter
 */
router.get('/ratelimit/:discordId', async (req: Request, res: Response) => {
  try {
    const discordId = req.params.discordId as string;

    const usage = await rateLimiter.getUsage(discordId);

    res.json({
      count: usage.count,
      limit: 15,
      windowSeconds: 60,
      resetInSeconds: usage.resetInSeconds,
    });
  } catch (error) {
    logger.error('Internal ratelimit get error', { error });
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /internal/ratelimit/reset/:discordId
 * Reset the rate limit counter for a Discord user
 * Used by moderators
 */
router.post('/ratelimit/reset/:discordId', async (req: Request, res: Response) => {
  try {
    const discordId = req.params.discordId as string;

    await rateLimiter.reset(discordId);

    logger.info('Rate limit reset via internal API', { discordId });

    res.json({ success: true });
  } catch (error) {
    logger.error('Internal ratelimit reset error', { error });
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * GET /health
 * No auth required - for load balancer / Docker health checks
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    // Check Redis
    let redisOk = false;
    try {
      await redis.ping();
      redisOk = true;
    } catch {}

    // Check PostgreSQL
    let dbOk = false;
    try {
      await memberRepo.getStats();
      dbOk = true;
    } catch {}

    const healthy = redisOk && dbOk;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      service: 'discord-gate',
      checks: {
        redis: redisOk,
        database: dbOk,
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'down',
      service: 'discord-gate',
      error: String(error),
    });
  }
});

export default router;