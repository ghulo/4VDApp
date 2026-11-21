import { Router } from 'express';
import type { Container } from '../container.js';
import { createBillScanController } from '../controllers/billScanController.js';

/**
 * Scanned supplier bills: anyone on the team can scan one; the people who run
 * the shop check and confirm it. The accountant may open them and confirm the
 * bill of a delivery staff already put into stock (the service refuses any
 * confirm that would change stock or products for them).
 */
export function createBillScanRoutes({ billScanService, guards }: Container): Router {
  const controller = createBillScanController(billScanService);
  const router = Router();

  router.post('/', ...guards.staff, controller.scan);
  // Only the developer can take a decided scan back: it reverses stock, the bill and the order.
  router.post('/:id/reopen', ...guards.developer, controller.reopen);
  router.get('/', ...guards.billWriters, controller.waiting);
  router.get('/:id', ...guards.billWriters, controller.get);
  router.post('/:id/confirm', ...guards.billWriters, controller.confirm);
  router.use(...guards.oversee);
  // The phone's check: confirm as it stands, or finish on the dashboard.
  router.get('/:id/quick', controller.quickCheck);
  router.post('/:id/quick-confirm', controller.quickConfirm);
  router.post('/:id/customs', controller.confirmCustoms);
  router.post('/:id/discard', controller.discard);

  return router;
}
