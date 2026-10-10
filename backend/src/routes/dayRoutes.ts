import { Router } from 'express';
import type { Container } from '../container.js';
import { createDayController } from '../controllers/dayController.js';

export function createDayRoutes({ dayService, guards }: Container): Router {
  const controller = createDayController(dayService);
  const router = Router();

  // The end-of-day checklist; only managers add expenses, so only they may say there were none.
  router.get('/today', ...guards.oversee, controller.today);
  router.put('/today/no-expenses', ...guards.manage, controller.setNoExpenses);

  return router;
}
