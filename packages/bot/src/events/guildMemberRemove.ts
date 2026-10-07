import { Events, GuildMember, PartialGuildMember } from 'discord.js';
import { discordGateConfig } from '@proxy-hub/discord-gate/config/discordGateConfig';
import { logger } from '../utils/logger';
import { client } from '../client';

interface RevokeResult {
  sessionsRevoked: number;
  keysRevoked: number;
}

async function callSidecarRevoke(params: {
  discordId: string;
  reason: string;
}): Promise<RevokeResult | null> {
  const url = `${discordGateConfig.DISCORD_GATE_INTERNAL_URL}/internal/revoke-member`;
  const secret = discordGateConfig.BOT_INTERNAL_SECRET;

  const backoff = [1000, 2000, 4000];

  for (let attempt = 0; attempt < backoff.length; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': secret,
        },
        body: JSON.stringify(params),
      });

      if (response.ok) {
        const data = await response.json() as RevokeResult;
        return data;
      }

      // Don't retry on client errors (4xx)
      if (response.status >= 400 && response.status < 500) {
        const errorText = await response.text();
        logger.error('Sidecar revoke failed (client error)', {
          discordId: params.discordId,
          reason: params.reason,
          status: response.status,
          response: errorText,
        });
        return null;
      }

      // Retry on server errors (5xx) or network issues
      if (attempt < backoff.length - 1) {
        logger.warn('Sidecar revoke failed (server error), retrying', {
          discordId: params.discordId,
          attempt: attempt + 1,
          status: response.status,
          backoffMs: backoff[attempt],
        });
        await new Promise((resolve) => setTimeout(resolve, backoff[attempt]));
        continue;
      }
    } catch (error) {
      // Network error - retry
      if (attempt < backoff.length - 1) {
        logger.warn('Sidecar revoke network error, retrying', {
          discordId: params.discordId,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
          backoffMs: backoff[attempt],
        });
        await new Promise((resolve) => setTimeout(resolve, backoff[attempt]));
        continue;
      }
    }
  }

  // All retries failed
  logger.error('Sidecar revoke failed after all retries', {
    discordId: params.discordId,
    reason: params.reason,
  });
  return null;
}

function isFullGuildMember(member: GuildMember | PartialGuildMember): member is GuildMember {
  return 'guild' in member && member.guild !== undefined;
}

client.on(Events.GuildMemberRemove, async (member: GuildMember | PartialGuildMember) => {
  // Handle PartialGuildMember - may not have guild info
  if (!isFullGuildMember(member)) {
    return;
  }

  // Check if this is our target guild
  if (member.guild.id !== discordGateConfig.TARGET_GUILD_ID) {
    return;
  }

  logger.info('Member left guild', {
    discordId: member.id,
    username: member.user?.username ?? 'unknown',
    guildId: member.guild.id,
  });

  const result = await callSidecarRevoke({
    discordId: member.id,
    reason: 'member_left',
  });

  if (result) {
    logger.info('Member left — revocation result', {
      discordId: member.id,
      sessionsRevoked: result.sessionsRevoked,
      keysRevoked: result.keysRevoked,
    });
  } else {
    logger.error('Failed to revoke member access after all retries', {
      discordId: member.id,
    });
  }
});

interface RevokeResult {
  sessionsRevoked: number;
  keysRevoked: number;
}