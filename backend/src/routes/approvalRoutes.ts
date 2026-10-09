import { Router } from 'express';
import type { Container } from '../container.js';
import { createApprovalsController } from '../controllers/approvalsController.js';
import { createReturnsController } from '../controllers/returnsController.js';
import { createSettingsController } from '../controllers/settingsController.js';
import { createStockCountsController } from '../controllers/stockCountsController.js';
import { createWriteOffsController } from '../controllers/writeOffsController.js';

export function createSettingsRoutes({ settingsService, launchService, guards }: Container): Router {
  const controller = createSettingsController(settingsService, launchService);
  const router = Router();

  // Employees read the limits so the phone can say when something needs approval.
  router.get('/', ...guards.staff, controller.get);
  router.put('/', ...guards.manage, controller.update);
  // What's left before the real shop starts using the app.
  router.get('/launch-checklist', ...guards.developer, controller.launchChecklist);
  // Clears the test data before launch (developer only; the phrase must be typed).
  router.get('/wipe-preview', ...guards.developer, controller.wipePreview);
  router.post('/wipe', ...guards.developer, controller.wipe);

  return router;
}

export function createWriteOffRoutes({ writeOffService, guards }: Container): Router {
  const controller = createWriteOffsController(writeOffService);
  const router = Router();

  router.get('/', ...guards.oversee, controller.list);
  router.post('/', ...guards.staff, controller.request);
  router.post('/:id/approve', ...guards.oversee, controller.approve);
  router.post('/:id/reject', ...guards.oversee, controller.reject);

  return router;
}

export function createReturnRoutes({ returnService, guards }: Container): Router {
  const controller = createReturnsController(returnService);
  const router = Router();

  router.get('/', ...guards.oversee, controller.list);
  router.post('/:id/approve', ...guards.oversee, controller.approve);
  router.post('/:id/reject', ...guards.oversee, controller.reject);

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
  router.post('/:id/lines/:productId/approve', ...guards.oversee, controller.approveLine);
  router.post('/:id/lines/:productId/reject', ...guards.oversee, controller.rejectLine);
  router.post('/:id/approve-all', ...guards.oversee, controller.approveAll);

  return router;
}

export function createApprovalRoutes({ approvalService, guards }: Container): Router {
  const controller = createApprovalsController(approvalService);
  const router = Router();

  router.get('/summary', ...guards.oversee, controller.summary);
  router.get('/mine', ...guards.staff, controller.mine);

  return router;
}
