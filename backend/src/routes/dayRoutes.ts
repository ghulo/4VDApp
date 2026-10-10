import { Router } from 'express';
import type { Container } from '../container.js';
import { createDayController } from '../controllers/dayController.js';

export function createDayRoutes({ dayService, guards }: Container): Router {
  const controller = createDayController(dayService);
  const router = Router();

  // The shop day's steps: everyone at the counter sees the ones they close,
  // overseers see the whole day. Only managers add expenses, so only they say there were none.
  router.get('/', ...guards.staff, controller.get);
  router.put('/no-expenses', ...guards.manage, controller.setNoExpenses);

  return router;
}
