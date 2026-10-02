import { Router } from 'express';
import type { Container } from '../container.js';
import { createReportsController } from '../controllers/reportsController.js';

export function createReportsRoutes({ reportsService, insightsService, dailySummaryService, guards }: Container): Router {
  const controller = createReportsController(reportsService, insightsService, dailySummaryService);
  const router = Router();

  router.get('/summary', ...guards.oversee, controller.summary);
  router.get('/team', ...guards.oversee, controller.team);
  router.get('/profit', ...guards.oversee, controller.profit);
  router.get('/reorder-suggestions', ...guards.oversee, controller.reorderSuggestions);
  router.get('/insights', ...guards.oversee, controller.insights);
  // What tonight's summary would say right now, for the Overview page.
  router.get('/daily-summary', ...guards.oversee, controller.dailySummary);
  // Employees see their own numbers; family members don't sell.
  router.get('/my-sales', ...guards.staff, controller.mySales);

  return router;
}
