import { Router } from 'express';
import type { Container } from '../container.js';
import { createActivityController } from '../controllers/activityController.js';

export function createActivityRoutes({ activityLogService, guards }: Container): Router {
  const controller = createActivityController(activityLogService);
  const router = Router();

  router.get('/', ...guards.oversee, controller.list);

  return router;
}
