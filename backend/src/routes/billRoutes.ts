import { Router } from 'express';
import type { Container } from '../container.js';
import { createBillController } from '../controllers/billController.js';
import { readImage } from './profileRoutes.js';

/** Supplier bills and their payments. The people who run the shop handle them; the accountant reads them. */
export function createBillRoutes({ supplierBillService, guards }: Container): Router {
  const controller = createBillController(supplierBillService);
  const router = Router();

  router.get('/', ...guards.books, controller.list);
  router.get('/summary', ...guards.books, controller.summary);
  router.get('/repeats', ...guards.books, controller.repeats);
  router.post('/repeats/:id/stop', ...guards.oversee, controller.stopRepeat);
  router.post('/preview', ...guards.oversee, controller.preview);
  router.get('/:id', ...guards.books, controller.get);
  router.post('/', ...guards.oversee, controller.create);
  router.put('/:id', ...guards.oversee, controller.update);
  router.post('/:id/payments', ...guards.oversee, controller.pay);
  router.post('/:id/payments/:paymentId/void', ...guards.oversee, controller.voidPayment);
  router.post('/:id/void', ...guards.oversee, controller.void);
  router.post('/:id/credit', ...guards.oversee, controller.credit);
  router.put('/:id/photo', ...guards.oversee, readImage, controller.setPhoto);
  router.delete('/:id/photo', ...guards.oversee, controller.removePhoto);

  return router;
}
