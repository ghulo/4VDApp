import { Router } from 'express';
import type { Container } from '../container.js';
import { createOrderController } from '../controllers/orderController.js';

export function createSupplierRoutes({ purchaseOrderService, guards }: Container): Router {
  const controller = createOrderController(purchaseOrderService);
  const router = Router();

  router.get('/', ...guards.oversee, controller.suppliers);
  router.post('/', ...guards.manage, controller.addSupplier);
  router.put('/:id', ...guards.manage, controller.updateSupplier);
  router.delete('/:id', ...guards.manage, controller.removeSupplier);

  return router;
}

export function createOrderRoutes({ purchaseOrderService, guards }: Container): Router {
  const controller = createOrderController(purchaseOrderService);
  const router = Router();

  router.get('/', ...guards.oversee, controller.list);
  router.get('/deliveries', ...guards.staff, controller.deliveries);
  router.get('/usual-suppliers', ...guards.oversee, controller.usualSuppliers);
  router.post('/', ...guards.manage, controller.create);
  // Anyone at the counter can tick off a delivery; only managers can change costs while doing it.
  router.post('/:id/receive', ...guards.staff, controller.receive);
  router.post('/:id/cancel', ...guards.manage, controller.cancel);

  return router;
}
