import { Router } from 'express';
import type { Container } from '../container.js';
import { createReportsController } from '../controllers/reportsController.js';

export function createReportsRoutes({ reportsService, guards }: Container): Router {
  const controller = createReportsController(reportsService);
  const router = Router();

  router.get('/summary', ...guards.admin, controller.summary);
  router.get('/team', ...guards.admin, controller.team);
  router.get('/profit', ...guards.admin, controller.profit);
  router.get('/reorder-suggestions', ...guards.admin, controller.reorderSuggestions);
  // Employees see their own numbers; family members don't sell.
  router.get('/my-sales', ...guards.staff, controller.mySales);

  return router;
}
