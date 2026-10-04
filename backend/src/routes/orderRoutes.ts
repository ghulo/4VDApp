import { Router } from 'express';
import type { Container } from '../container.js';
import { createOrderController } from '../controllers/orderController.js';

export function createSupplierRoutes({ purchaseOrderService, guards }: Container): Router {
  const controller = createOrderController(purchaseOrderService);
  const router = Router();

  router.get('/', ...guards.oversee, controller.suppliers);
  router.post('/', ...guards.manage, controller.addSupplier);
  router.delete('/:id', ...guards.manage, controller.removeSupplier);

  return router;
}

export function createOrderRoutes({ purchaseOrderService, guards }: Container): Router {
  const controller = createOrderController(purchaseOrderService);
  const router = Router();

  router.get('/', ...guards.oversee, controller.list);
  router.get('/usual-suppliers', ...guards.oversee, controller.usualSuppliers);
  router.post('/', ...guards.manage, controller.create);
  router.post('/:id/receive', ...guards.manage, controller.receive);
  router.post('/:id/cancel', ...guards.manage, controller.cancel);

  return router;
}
