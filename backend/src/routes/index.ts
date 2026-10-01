import { Router } from 'express';
import type { Container } from '../container.js';
import { createAuthRoutes } from './authRoutes.js';
import {
  createCategoryRoutes,
  createInventoryRoutes,
  createPricingRoutes,
  createProductRoutes,
} from './catalogRoutes.js';
import {
  createAnalyticsRoutes,
  createFavoriteRoutes,
  createNotificationRoutes,
  createSalesRoutes,
  createUserRoutes,
} from './operationsRoutes.js';

/** Root router for everything under /api. */
export function createApiRoutes(container: Container): Router {
  const router = Router();

  router.use('/auth', createAuthRoutes(container));
  router.use('/categories', createCategoryRoutes(container));
  router.use('/products', createProductRoutes(container));
  router.use('/inventory', createInventoryRoutes(container));
  router.use('/pricing', createPricingRoutes(container));
  router.use('/sales', createSalesRoutes(container));
  router.use('/analytics', createAnalyticsRoutes(container));
  router.use('/users', createUserRoutes(container));
  router.use('/notifications', createNotificationRoutes(container));
  router.use('/favorites', createFavoriteRoutes(container));

  return router;
}
