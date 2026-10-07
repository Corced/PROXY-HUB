// FIRST: validate all env vars before anything else
import { discordGateConfig } from './config/discordGateConfig';
import { app } from './app';
import { logger } from './utils/logger';
import { redis } from './routes/auth';
import { syncScheduler } from './services/syncScheduler';

async function start(): Promise<void> {
  // Connect to Redis
  try {
    await redis.connect();
    logger.info('Connected to Redis');
  } catch (error) {
    logger.error('Failed to connect to Redis', { error });
    process.exit(1);
  }

  // Start HTTP server
  app.listen(discordGateConfig.DISCORD_GATE_PORT, () => {
    logger.info(`DiscordGate sidecar running on port ${discordGateConfig.DISCORD_GATE_PORT}`);
  });

  // Start sync scheduler
  syncScheduler.start();
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  syncScheduler.stop();
  await redis.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  syncScheduler.stop();
  await redis.quit();
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

start();