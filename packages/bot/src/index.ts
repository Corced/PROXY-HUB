// FIRST: import config (runs validation before anything else)
import { discordGateConfig } from '@proxy-hub/discord-gate/config/discordGateConfig';
import { client } from './client';
import { startBotHttpServer } from './http/server';
import { logger } from './utils/logger';

// Import events to register them
import './events/ready';
import './events/guildMemberRemove';
import './events/guildBanAdd';
import './events/guildMemberUpdate';

// Start internal HTTP server
startBotHttpServer();

// Login to Discord
client.login(discordGateConfig.DISCORD_BOT_TOKEN).catch((error) => {
  logger.error('Failed to login to Discord', { error });
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  client.destroy();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  client.destroy();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
  process.exit(1);
});

logger.info('Bot process started', {
  port: discordGateConfig.BOT_PORT,
  targetGuild: discordGateConfig.TARGET_GUILD_ID,
});