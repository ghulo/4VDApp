import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { AppConfig } from './config/env.js';
import { type Container, type ContainerOptions, createContainer } from './container.js';
import type { DatabaseClient } from './database/connection.js';
import { identifyRequester } from './middlewares/authenticate.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { notFoundHandler } from './middlewares/notFoundHandler.js';
import { createApiRateLimiter } from './middlewares/rateLimiter.js';
import { healthRoutes } from './routes/healthRoutes.js';
import { createApiRoutes } from './routes/index.js';

/**
 * Build the Express app without starting a server, so tests can exercise it
 * with supertest and server.ts stays responsible only for listening.
 */
export interface AppOptions extends ContainerOptions {
  /** Share one container with the server, which also runs background work. */
  container?: Container;
}

export function createApp(config: AppConfig, db: DatabaseClient, options: AppOptions = {}): Express {
  const app = express();
  const container = options.container ?? createContainer(config, db, options);

  app.disable('x-powered-by');
  // Render and most hosts sit behind one proxy; without this every request
  // looks like it comes from the proxy and shares one rate limit.
  if (config.nodeEnv === 'production') app.set('trust proxy', 1);

  app.use(helmet());
  // Browsers hide Content-Disposition from cross-origin JS unless it is exposed,
  // and the admin dashboard needs it to name downloaded CSV files.
  app.use(cors({ origin: config.corsOrigins, exposedHeaders: ['Content-Disposition'] }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));

  // Health check stays outside /api and the rate limiter so uptime monitors
  // never get throttled.
  app.use('/health', healthRoutes);
  app.use('/api', identifyRequester(config.jwtSecret), createApiRateLimiter(), createApiRoutes(container));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
