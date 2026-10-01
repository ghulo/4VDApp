import { Router } from 'express';
import type { Container } from '../container.js';
import { createActivityRoutes } from './activityRoutes.js';
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
import {
  createApprovalRoutes,
  createReturnRoutes, createSettingsRoutes, createStockCountRoutes, createWriteOffRoutes } from './approvalRoutes.js';
import { createExportsRoutes } from './exportsRoutes.js';
import { createReportsRoutes } from './reportsRoutes.js';

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
  router.use('/activity', createActivityRoutes(container));
  router.use('/reports', createReportsRoutes(container));
  router.use('/exports', createExportsRoutes(container));
  router.use('/settings', createSettingsRoutes(container));
  router.use('/write-offs', createWriteOffRoutes(container));
  router.use('/returns', createReturnRoutes(container));
  router.use('/stock-counts', createStockCountRoutes(container));
  router.use('/approvals', createApprovalRoutes(container));

  return router;
}
