import { Router } from 'express';
import type { Container } from '../container.js';
import { createCashCountController } from '../controllers/cashCountController.js';

export function createCashCountRoutes({ cashCountService, guards }: Container): Router {
  const controller = createCashCountController(cashCountService);
  const router = Router();

  router.get('/', ...guards.oversee, controller.list);
  // Whoever closes up counts the drawer: staff, admins and the developer.
  router.get('/today', ...guards.staff, controller.today);
  router.post('/', ...guards.staff, controller.count);

  return router;
}
