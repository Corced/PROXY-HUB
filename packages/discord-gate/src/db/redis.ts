import Redis from 'ioredis';
import { discordGateConfig } from '../config/discordGateConfig';
import { logger } from '../utils/logger';

export const redisClient = new Redis(discordGateConfig.REDIS_URL, {
  lazyConnect: false,
  retryStrategy: (times: number) => Math.min(times * 500, 5000),
  maxRetriesPerRequest: 3,
});

redisClient.on('connect', () => logger.info('Redis connected'));
redisClient.on('error', (err: Error) => logger.error('Redis error', { err }));
redisClient.on('reconnecting', () => logger.warn('Redis reconnecting'));

export default redisClient;