import { Router, Request, Response, NextFunction } from 'express';
import { discordGateConfig } from '@proxy-hub/discord-gate/config/discordGateConfig';
import { logger } from '../../utils/logger';
import { client } from '../../client';

const router = Router();

const INTERNAL_SECRET_HEADER = 'x-internal-secret';

// Middleware to verify internal secret
function requireInternalSecret(req: Request, res: Response, next: NextFunction): void {
  const provided = req.headers[INTERNAL_SECRET_HEADER];
  const expected = discordGateConfig.BOT_INTERNAL_SECRET;

  if (!provided || provided !== expected) {
    logger.warn('Unauthorized internal verify access attempt', {
      ip: req.ip,
      path: req.path,
    });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

/**
 * GET /internal/verify/:discordUserId
 *
 * Called by DiscordGate sidecar to verify guild membership.
 * Returns { isMember: boolean, roles: string[] }
 */
router.get('/verify/:discordUserId', requireInternalSecret, async (req: Request, res: Response) => {
  try {
    const { discordUserId } = req.params;

    if (!discordUserId || !/^\d{17,19}$/.test(discordUserId)) {
      return res.status(400).json({ error: 'Invalid Discord user ID' });
    }

    const guild = client.guilds.cache.get(discordGateConfig.TARGET_GUILD_ID);
    if (!guild) {
      logger.error('Target guild not found in cache', { targetGuildId: discordGateConfig.TARGET_GUILD_ID });
      return res.status(500).json({ error: 'Guild not available' });
    }

    try {
      const member = await guild.members.fetch(discordUserId);

      return res.json({
        isMember: true,
        roles: [...member.roles.cache.keys()].filter((id) => id !== guild.id), // exclude @everyone
      });
    } catch (err: any) {
      // Discord API error code 10007 = Unknown Member
      if (err?.code === 10007) {
        return res.json({ isMember: false, roles: [] });
      }
      throw err;
    }
  } catch (error) {
    logger.error('Internal verify error', { error, discordUserId: req.params.discordUserId });
    return res.status(500).json({ error: 'Internal error' });
  }
});

export default router;