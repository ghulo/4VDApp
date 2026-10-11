import { Router } from 'express';
import type { Container } from '../container.js';
import { createBillScanController } from '../controllers/billScanController.js';

/** Scanned supplier bills: anyone on the team can scan one; the people who run the shop check and confirm it. */
export function createBillScanRoutes({ billScanService, guards }: Container): Router {
  const controller = createBillScanController(billScanService);
  const router = Router();

  router.post('/', ...guards.staff, controller.scan);
  // Only the developer can take a decided scan back: it reverses stock, the bill and the order.
  router.post('/:id/reopen', ...guards.developer, controller.reopen);
  router.use(...guards.oversee);
  router.get('/', controller.waiting);
  router.get('/:id', controller.get);
  // The phone's check: confirm as it stands, or finish on the dashboard.
  router.get('/:id/quick', controller.quickCheck);
  router.post('/:id/quick-confirm', controller.quickConfirm);
  router.post('/:id/confirm', controller.confirm);
  router.post('/:id/discard', controller.discard);

  return router;
}
