import { Events, GuildBan } from 'discord.js';
import { discordGateConfig } from '@proxy-hub/discord-gate/config/discordGateConfig';
import { logger } from '../utils/logger';
import { client } from '../client';
import { sidecarClient } from '../services/sidecarClient';

client.on(Events.GuildBanAdd, async (ban: GuildBan) => {
  // Check if this is our target guild
  if (!ban.guild || ban.guild.id !== discordGateConfig.TARGET_GUILD_ID) {
    return;
  }

  logger.info('Member banned from guild', {
    discordId: ban.user.id,
    username: ban.user.username,
    guildId: ban.guild.id,
    reason: ban.reason,
  });

  const result = await sidecarClient.revokeMember({
    discordId: ban.user.id,
    reason: 'member_banned',
  });

  if (result) {
    logger.info('Member banned — revocation result', {
      discordId: ban.user.id,
      sessionsRevoked: result.sessionsRevoked,
      keysRevoked: result.keysRevoked,
    });
  } else {
    logger.error('Failed to revoke banned member access after all retries', {
      discordId: ban.user.id,
    });
  }
});