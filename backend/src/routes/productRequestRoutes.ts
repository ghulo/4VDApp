import { Router } from 'express';
import type { Container } from '../container.js';
import { createProductRequestController } from '../controllers/productRequestController.js';

/** New products from the counter: anyone on the team asks; the people who run the shop decide. */
export function createProductRequestRoutes({ productRequestService, guards }: Container): Router {
  const controller = createProductRequestController(productRequestService);
  const router = Router();

  router.post('/', ...guards.staff, controller.submit);
  router.get('/', ...guards.oversee, controller.pending);
  router.get('/:id', ...guards.oversee, controller.get);
  router.post('/:id/approve', ...guards.oversee, controller.approve);
  router.post('/:id/reject', ...guards.oversee, controller.reject);

  return router;
}
