import { Client, GatewayIntentBits, Events, GuildMember, GuildBan, Guild } from 'discord.js';
import { discordGateConfig } from '@proxy-hub/discord-gate/config/discordGateConfig';
import { logger } from './utils/logger';

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    // PRIVILEGED INTENT — enable in Discord Developer Portal:
    // Bot → Privileged Gateway Intents → Server Members Intent → ON
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildBans,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  logger.info(`Bot logged in as ${readyClient.user.tag}`, {
    guilds: readyClient.guilds.cache.size,
    targetGuild: discordGateConfig.TARGET_GUILD_ID,
  });
});

client.on(Events.Error, (error) => {
  logger.error('Discord client error', { error });
});

client.on(Events.Warn, (warning) => {
  logger.warn('Discord client warning', { warning });
});

// Export helper to get target guild
export function getTargetGuild(): Guild | undefined {
  return client.guilds.cache.get(discordGateConfig.TARGET_GUILD_ID);
}