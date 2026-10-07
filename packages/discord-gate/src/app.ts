import express, { Application, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { discordGateConfig } from './config/discordGateConfig';
import { logger } from './utils/logger';
import authRoutes from './routes/auth';
import verifyRoutes from './routes/verify';
import internalRoutes from './routes/internal';
import { redis } from './routes/auth';

const app: Application = express();

// Trust proxy (needed for secure cookies behind Caddy)
app.set('trust proxy', 1);

// Request logger
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.debug('HTTP request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      ip: req.ip,
    });
  });
  next();
});

// Parse cookies
app.use(cookieParser());

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount routes
app.use('/auth', authRoutes);
app.use('/verify', verifyRoutes);
app.use('/internal', internalRoutes);

// Health check (no auth)
app.get('/health', async (req: Request, res: Response) => {
  let redisOk = false;
  try {
    await redis.ping();
    redisOk = true;
  } catch {}

  const healthy = redisOk;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    service: 'discord-gate',
    checks: { redis: redisOk },
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler (4-argument middleware)
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });
  res.status(500).json({ error: 'Internal server error' });
});

export { app };