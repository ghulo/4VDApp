import { Router } from 'express';
import type { Container } from '../container.js';
import { createExpenseController } from '../controllers/expenseController.js';

export function createExpenseRoutes({ expenseService, guards }: Container): Router {
  const controller = createExpenseController(expenseService);
  const router = Router();

  router.get('/', ...guards.oversee, controller.list);
  router.post('/', ...guards.manage, controller.add);
  router.get('/recurring', ...guards.oversee, controller.recurring);
  router.post('/recurring/:id/stop', ...guards.manage, controller.stopRepeating);
  router.delete('/:id', ...guards.manage, controller.remove);

  return router;
}
