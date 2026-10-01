import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { AppConfig } from './config/env.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { notFoundHandler } from './middlewares/notFoundHandler.js';
import { publicRateLimiter } from './middlewares/rateLimiter.js';
import { healthRoutes } from './routes/healthRoutes.js';
import { apiRoutes } from './routes/index.js';

/**
 * Build the Express app without starting a server, so tests can exercise it
 * with supertest and server.ts stays responsible only for listening.
 */
export function createApp(config: AppConfig): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));

  // Health check stays outside /api and the rate limiter so uptime monitors
  // never get throttled.
  app.use('/health', healthRoutes);
  app.use('/api', publicRateLimiter, apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
