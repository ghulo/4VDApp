import { Router } from 'express';
import type { Container } from '../container.js';
import { createCustomerController } from '../controllers/customerController.js';

export function createCustomerRoutes({ tabService, guards }: Container): Router {
  const controller = createCustomerController(tabService);
  const router = Router();

  // At the counter, staff open tabs, put sales on them and take payments.
  router.get('/', ...guards.staff, controller.list);
  router.post('/', ...guards.staff, controller.create);
  router.get('/:id', ...guards.staff, controller.detail);
  router.post('/:id/payments', ...guards.staff, controller.pay);
  // Changing details and closing tabs is for managers.
  router.put('/:id', ...guards.manage, controller.update);
  router.post('/:id/archive', ...guards.manage, controller.archive);

  return router;
}
