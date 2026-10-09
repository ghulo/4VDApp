import { Router } from 'express';
import type { Container } from '../container.js';
import { createBillController } from '../controllers/billController.js';
import { readImage } from './profileRoutes.js';

/** Supplier bills and their payments. The people who run the shop handle them. */
export function createBillRoutes({ supplierBillService, guards }: Container): Router {
  const controller = createBillController(supplierBillService);
  const router = Router();

  router.use(...guards.oversee);
  router.get('/', controller.list);
  router.get('/summary', controller.summary);
  router.get('/:id', controller.get);
  router.post('/', controller.create);
  router.put('/:id', controller.update);
  router.post('/:id/payments', controller.pay);
  router.post('/:id/payments/:paymentId/void', controller.voidPayment);
  router.post('/:id/void', controller.void);
  router.put('/:id/photo', readImage, controller.setPhoto);
  router.delete('/:id/photo', controller.removePhoto);

  return router;
}
