import { Events } from 'discord.js';
import { client } from '../client';
import { discordGateConfig } from '@proxy-hub/discord-gate/config/discordGateConfig';
import { logger } from '../utils/logger';

client.once(Events.ClientReady, (readyClient) => {
  logger.info('Bot ready event fired', {
    user: readyClient.user.tag,
    guildCount: readyClient.guilds.cache.size,
    targetGuildId: readyClient.guilds.cache.has(discordGateConfig.TARGET_GUILD_ID)
      ? 'FOUND'
      : 'NOT FOUND',
  });
});