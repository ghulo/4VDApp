import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { AppConfig } from './config/env.js';
import { type Container, type ContainerOptions, createContainer } from './container.js';
import type { DatabaseClient } from './database/connection.js';
import { identifyRequester, refuseForeignOrigins } from './middlewares/authenticate.js';
import { allowedOriginsOf } from './utils/sessionCookies.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { notFoundHandler } from './middlewares/notFoundHandler.js';
import { createApiRateLimiter } from './middlewares/rateLimiter.js';
import { healthRoutes } from './routes/healthRoutes.js';
import { createApiRoutes } from './routes/index.js';
import { createPortalRoutes } from './routes/portalRoutes.js';
import { billEmailTokenGuard } from './routes/internalRoutes.js';

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
  // credentials: the portal and the dashboard both sign in with httpOnly cookies.
  app.use(cors({ origin: config.corsOrigins, credentials: true, exposedHeaders: ['Content-Disposition'] }));
  app.use(compression());
  // Scanned bills arrive as base64 photos or PDFs: several pages, a few MB each.
  app.use('/api/bill-scans', express.json({ limit: '40mb' }));
  // Email Routing takes mails up to 25 MB, which is about 34 MB as base64. The secret is checked first.
  app.use('/api/internal/bill-email', billEmailTokenGuard(config), express.json({ limit: '40mb' }));
  // Bank statements come as base64 files, up to 10 MB each.
  app.use('/api/money/places', express.json({ limit: '15mb' }));
  app.use('/api/products/prices', express.json({ limit: '15mb' }));
  app.use('/api/partners/read', express.json({ limit: '25mb' }));
  app.use(express.json({ limit: '1mb' }));

  // Health check stays outside /api and the rate limiter so uptime monitors
  // never get throttled.
  app.use('/health', healthRoutes);
  // Public pages also hide costs by role, so the rules from Settings → Roles are read before any API request.
  const loadPermissions: express.RequestHandler = (_req, _res, next) => {
    container.permissionService.ensureLoaded().then(() => next(), next);
  };
  // The business customers' portal: its own cookie sign-in, limits and origin check; no dashboard middleware.
  app.use('/api/portal', createPortalRoutes(container));
  const ownOrigins = allowedOriginsOf(config);
  app.use('/api', refuseForeignOrigins(ownOrigins), identifyRequester(config.jwtSecret, ownOrigins), loadPermissions, createApiRateLimiter(), createApiRoutes(container));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
