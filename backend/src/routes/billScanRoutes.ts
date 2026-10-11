import { Router } from 'express';
import type { Container } from '../container.js';
import { createBillScanController } from '../controllers/billScanController.js';

/** Scanned supplier bills: anyone on the team can scan one; the people who run the shop check and confirm it. */
export function createBillScanRoutes({ billScanService, guards }: Container): Router {
  const controller = createBillScanController(billScanService);
  const router = Router();

  router.post('/', ...guards.staff, controller.scan);
  router.use(...guards.oversee);
  router.get('/', controller.waiting);
  router.get('/:id', controller.get);
  router.post('/:id/confirm', controller.confirm);
  router.post('/:id/discard', controller.discard);

  return router;
}
