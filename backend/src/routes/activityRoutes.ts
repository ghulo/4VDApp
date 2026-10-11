import { Router } from 'express';
import type { Container } from '../container.js';
import { createActivityController } from '../controllers/activityController.js';

export function createActivityRoutes({ activityLogService, undoService, recordRestoreService, guards }: Container): Router {
  const controller = createActivityController(activityLogService, undoService, recordRestoreService);
  const router = Router();

  router.get('/', ...guards.oversee, controller.list);
  router.get('/history', ...guards.oversee, controller.history);
  // Who may undo whose entries is checked per entry (undoRules.canUndo).
  router.post('/:id/undo', ...guards.oversee, controller.undo);
  router.post('/:id/restore', ...guards.oversee, controller.restore);
  // Putting a whole record back to an earlier point is for the developer only.
  router.get('/:id/restore-point', ...guards.developer, controller.restorePlan);
  router.post('/:id/restore-point', ...guards.developer, controller.restoreTo);

  return router;
}
