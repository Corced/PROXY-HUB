import express, { Application, Request, Response, NextFunction } from 'express';
import { discordGateConfig } from '@proxy-hub/discord-gate/config/discordGateConfig';
import { logger } from '../utils/logger';
import verifyRoutes from './routes/verify';

const app: Application = express();

app.use(express.json());

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

// Mount internal routes
app.use('/internal', verifyRoutes);

// Health check (no auth)
app.get('/internal/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'discord-bot',
    uptime: process.uptime(),
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });
  res.status(500).json({ error: 'Internal server error' });
});

export function startBotHttpServer(): void {
  app.listen(discordGateConfig.BOT_PORT, () => {
    logger.info(`Bot internal HTTP server running on port ${discordGateConfig.BOT_PORT}`);
  });
}