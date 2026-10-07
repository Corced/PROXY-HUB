import { Events, GuildMember, PartialGuildMember } from 'discord.js';
import { discordGateConfig } from '@proxy-hub/discord-gate/config/discordGateConfig';
import { logger } from '../utils/logger';
import { client } from '../client';
import { sidecarClient } from '../services/sidecarClient';

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

  const result = await sidecarClient.revokeMember({
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