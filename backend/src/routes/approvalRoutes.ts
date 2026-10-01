import { Router } from 'express';
import type { Container } from '../container.js';
import { createReturnsController } from '../controllers/returnsController.js';
import { createSettingsController } from '../controllers/settingsController.js';
import { createStockCountsController } from '../controllers/stockCountsController.js';
import { createWriteOffsController } from '../controllers/writeOffsController.js';

export function createSettingsRoutes({ settingsService, guards }: Container): Router {
  const controller = createSettingsController(settingsService);
  const router = Router();

  // Employees read the limits so the phone can say when something needs approval.
  router.get('/', ...guards.staff, controller.get);
  router.put('/', ...guards.admin, controller.update);

  return router;
}

export function createWriteOffRoutes({ writeOffService, guards }: Container): Router {
  const controller = createWriteOffsController(writeOffService);
  const router = Router();

  router.get('/', ...guards.admin, controller.list);
  router.post('/', ...guards.staff, controller.request);
  router.post('/:id/approve', ...guards.admin, controller.approve);
  router.post('/:id/reject', ...guards.admin, controller.reject);

  return router;
}

export function createReturnRoutes({ returnService, guards }: Container): Router {
  const controller = createReturnsController(returnService);
  const router = Router();

  router.get('/', ...guards.admin, controller.list);
  router.post('/:id/approve', ...guards.admin, controller.approve);
  router.post('/:id/reject', ...guards.admin, controller.reject);

  return router;
}

export function createStockCountRoutes({ stockCountService, guards }: Container): Router {
  const controller = createStockCountsController(stockCountService);
  const router = Router();

  router.get('/', ...guards.staff, controller.list);
  router.post('/', ...guards.staff, controller.start);
  router.get('/:id', ...guards.staff, controller.get);
  router.put('/:id/lines/:productId', ...guards.staff, controller.countLine);
  router.post('/:id/submit', ...guards.staff, controller.submit);
  // The service lets only the starter or an admin cancel.
  router.post('/:id/cancel', ...guards.staff, controller.cancel);
  router.post('/:id/lines/:productId/approve', ...guards.admin, controller.approveLine);
  router.post('/:id/lines/:productId/reject', ...guards.admin, controller.rejectLine);
  router.post('/:id/approve-all', ...guards.admin, controller.approveAll);

  return router;
}
