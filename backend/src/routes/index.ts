import { Router } from 'express';
import type { Container } from '../container.js';
import { createAuthRoutes } from './authRoutes.js';

/** Root router for everything under /api. */
export function createApiRoutes(container: Container): Router {
  const router = Router();

  router.use('/auth', createAuthRoutes(container));

  return router;
}
