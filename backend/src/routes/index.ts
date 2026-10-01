import { Router } from 'express';
import type { Container } from '../container.js';
import { createAuthRoutes } from './authRoutes.js';
import {
  createCategoryRoutes,
  createInventoryRoutes,
  createPricingRoutes,
  createProductRoutes,
} from './catalogRoutes.js';

/** Root router for everything under /api. */
export function createApiRoutes(container: Container): Router {
  const router = Router();

  router.use('/auth', createAuthRoutes(container));
  router.use('/categories', createCategoryRoutes(container));
  router.use('/products', createProductRoutes(container));
  router.use('/inventory', createInventoryRoutes(container));
  router.use('/pricing', createPricingRoutes(container));

  return router;
}
