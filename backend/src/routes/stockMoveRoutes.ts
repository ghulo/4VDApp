import { Router } from 'express';
import type { Container } from '../container.js';
import { createLocationController, createStockMoveController } from '../controllers/stockMoveController.js';

/** Moving stock between locations: read by anyone signed in, made and voided by those who oversee the shop. */
export function createStockMoveRoutes({ stockMoveService, guards }: Container): Router {
  const controller = createStockMoveController(stockMoveService);
  const router = Router();

  router.get('/', ...guards.team, controller.list);
  router.post('/', ...guards.oversee, controller.create);
  router.get('/:id', ...guards.team, controller.get);
  router.post('/:id/void', ...guards.oversee, controller.void);

  return router;
}

/** Where stock is kept: read by anyone signed in (for the pickers), set up by those who oversee the shop. */
export function createLocationRoutes({ locationService, guards }: Container): Router {
  const controller = createLocationController(locationService);
  const router = Router();

  router.get('/', ...guards.team, controller.list);
  router.post('/', ...guards.oversee, controller.create);
  router.patch('/:id', ...guards.oversee, controller.update);
  router.delete('/:id', ...guards.oversee, controller.remove);
  router.get('/products/:productId', ...guards.team, controller.forProduct);
  router.put('/products/:productId', ...guards.oversee, controller.setShelfMinimum);

  return router;
}
