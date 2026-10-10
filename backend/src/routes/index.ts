import { Router } from 'express';
import type { Container } from '../container.js';
import { createActivityRoutes } from './activityRoutes.js';
import { createAuthRoutes } from './authRoutes.js';
import { createCarwashRoutes } from './carwashRoutes.js';
import { createCashCountRoutes } from './cashCountRoutes.js';
import { createExpenseRoutes } from './expenseRoutes.js';
import { createCustomerRoutes } from './customerRoutes.js';
import { createDayRoutes } from './dayRoutes.js';
import { createAttentionRoutes } from './attentionRoutes.js';
import { createDocumentRoutes } from './documentRoutes.js';
import { createBillRoutes } from './billRoutes.js';
import { createOrderRoutes, createSupplierRoutes } from './orderRoutes.js';
import { createExpiryRoutes } from './expiryRoutes.js';
import {
  createCategoryRoutes,
  createInventoryRoutes,
  createPricingRoutes,
  createProductRoutes,
  createPromotionRoutes,
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
import { createAssistantRoutes } from './assistantRoutes.js';
import { createInternalRoutes } from './internalRoutes.js';
import { createInviteRoutes } from './inviteRoutes.js';
import { createMeRoutes } from './meRoutes.js';
import { createBusinessRoutes, createMediaRoutes } from './profileRoutes.js';
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
  router.use('/promotions', createPromotionRoutes(container));
  router.use('/sales', createSalesRoutes(container));
  router.use('/documents', createDocumentRoutes(container));
  router.use('/analytics', createAnalyticsRoutes(container));
  router.use('/users', createUserRoutes(container));
  router.use('/notifications', createNotificationRoutes(container));
  router.use('/favorites', createFavoriteRoutes(container));
  router.use('/activity', createActivityRoutes(container));
  router.use('/reports', createReportsRoutes(container));
  router.use('/carwash', createCarwashRoutes(container));
  router.use('/cash-counts', createCashCountRoutes(container));
  router.use('/expenses', createExpenseRoutes(container));
  router.use('/day', createDayRoutes(container));
  router.use('/attention', createAttentionRoutes(container));
  router.use('/customers', createCustomerRoutes(container));
  router.use('/suppliers', createSupplierRoutes(container));
  router.use('/orders', createOrderRoutes(container));
  router.use('/bills', createBillRoutes(container));
  router.use('/expiry', createExpiryRoutes(container));
  router.use('/exports', createExportsRoutes(container));
  router.use('/internal', createInternalRoutes(container));
  router.use('/settings', createSettingsRoutes(container));
  router.use('/write-offs', createWriteOffRoutes(container));
  router.use('/returns', createReturnRoutes(container));
  router.use('/stock-counts', createStockCountRoutes(container));
  router.use('/approvals', createApprovalRoutes(container));
  router.use('/assistant', createAssistantRoutes(container));
  router.use('/invites', createInviteRoutes(container));
  router.use('/me', createMeRoutes(container));
  router.use('/business', createBusinessRoutes(container));
  router.use('/media', createMediaRoutes(container));

  return router;
}
