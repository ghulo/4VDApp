import { Router } from 'express';
import type { Container } from '../container.js';
import { createActivityController } from '../controllers/activityController.js';

export function createActivityRoutes({ activityLogService, undoService, guards }: Container): Router {
  const controller = createActivityController(activityLogService, undoService);
  const router = Router();

  router.get('/', ...guards.oversee, controller.list);
  // Who may undo whose entries is checked per entry (undoRules.canUndo).
  router.post('/:id/undo', ...guards.oversee, controller.undo);
  router.post('/:id/restore', ...guards.oversee, controller.restore);

  return router;
}
