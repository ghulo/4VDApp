import { Router } from 'express';
import type { Container } from '../container.js';
import { createExportsController } from '../controllers/exportsController.js';

export function createExportsRoutes({ exportService, guards }: Container): Router {
  const controller = createExportsController(exportService);
  const router = Router();

  router.use(...guards.oversee);
  router.get('/sales.csv', controller.sales);
  router.get('/stock.csv', controller.stock);
  router.get('/team.csv', controller.team);
  router.get('/money.csv', controller.money);
  router.get('/expenses.csv', controller.expenses);

  return router;
}
