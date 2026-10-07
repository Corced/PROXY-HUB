import { ChatInputCommandInteraction, PermissionsBitField } from 'discord.js';
import { discordGateConfig } from '@proxy-hub/discord-gate/config/discordGateConfig';

/**
 * Check if a user has moderator permissions.
 * Checks in order:
 * 1. Discord owner ID (full access)
 * 2. ManageGuild permission
 * 3. Configured MOD_ROLE_ID
 */
export function hasModPermission(interaction: ChatInputCommandInteraction): boolean {
  // Check if user is the bot owner
  if (discordGateConfig.DISCORD_OWNER_ID && interaction.user.id === discordGateConfig.DISCORD_OWNER_ID) {
    return true;
  }

  // Check if user has ManageGuild permission
  if (interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    return true;
  }

  // Check if user has the configured mod role
  if (discordGateConfig.MOD_ROLE_ID) {
    const member = interaction.member;
    if (member && typeof member === 'object' && 'roles' in member) {
      const roles = (member as any).roles;
      if (roles && typeof roles === 'object' && 'cache' in roles) {
        return roles.cache.has(discordGateConfig.MOD_ROLE_ID);
      }
    }
  }

  return false;
}

/**
 * Standard reply for users without permission
 */
export function noPermissionReply() {
  return {
    content: '❌ You do not have permission to use this command.',
    ephemeral: true,
  };
}

import { data as checkaccessData, execute as checkaccessExecute } from './checkaccess';
import { data as revokeaccessData, execute as revokeaccessExecute } from './revokeaccess';
import { data as whitelistData, execute as whitelistExecute } from './whitelist';
import { data as botstatsData, execute as botstatsExecute } from './botstats';
import { data as syncmembersData, execute as syncmembersExecute } from './syncmembers';
import { data as apikeysData, execute as apikeysExecute } from './apikeys';

export interface CommandModule {
  data: any;
  execute: (interaction: any) => Promise<void>;
}

export const commands: CommandModule[] = [
  { data: checkaccessData, execute: checkaccessExecute },
  { data: revokeaccessData, execute: revokeaccessExecute },
  { data: whitelistData, execute: whitelistExecute },
  { data: botstatsData, execute: botstatsExecute },
  { data: syncmembersData, execute: syncmembersExecute },
  { data: apikeysData, execute: apikeysExecute },
];

export type Command = CommandModule;