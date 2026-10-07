import { Events, GuildMember, PartialGuildMember } from 'discord.js';
import { discordGateConfig } from '@proxy-hub/discord-gate/config/discordGateConfig';
import { logger } from '../utils/logger';
import { client } from '../client';

function isFullGuildMember(member: GuildMember | PartialGuildMember): member is GuildMember {
  return 'guild' in member && member.guild !== undefined;
}

client.on(Events.GuildMemberUpdate, async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember | PartialGuildMember) => {
  // Handle PartialGuildMember - may not have guild info
  if (!isFullGuildMember(oldMember) || !isFullGuildMember(newMember)) {
    return;
  }

  // Check if this is our target guild
  if (newMember.guild.id !== discordGateConfig.TARGET_GUILD_ID) {
    return;
  }

  // Only log significant role changes for now
  // Future: sync role changes to New API user group
  const addedRoles = newMember.roles.cache.filter(
    (role) => !oldMember.roles.cache.has(role.id)
  );
  const removedRoles = oldMember.roles.cache.filter(
    (role) => !newMember.roles.cache.has(role.id)
  );

  if (addedRoles.size > 0 || removedRoles.size > 0) {
    logger.info('Member roles updated', {
      userId: newMember.id,
      username: newMember.user.username,
      addedRoles: addedRoles.map((r) => r.name).join(', ') || 'none',
      removedRoles: removedRoles.map((r) => r.name).join(', ') || 'none',
    });

    // Future: call sidecar to update New API user group based on roles
    // await callSidecarUpdateGroup({ discordId: newMember.id, group: calculateGroup(newMember) });
  }
});