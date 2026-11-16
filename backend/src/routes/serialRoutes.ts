import { Router } from 'express';
import type { Container } from '../container.js';
import { createSerialController } from '../controllers/serialController.js';

/** Serial numbers: looked up and typed in by anyone selling; products marked and mistakes removed by those who oversee the shop. */
export function createSerialRoutes({ serialService, guards }: Container): Router {
  const controller = createSerialController(serialService);
  const router = Router();

  router.get('/', ...guards.staff, controller.search);
  router.post('/', ...guards.staff, controller.add);
  router.get('/products', ...guards.team, controller.products);
  router.get('/products/:productId', ...guards.staff, controller.forProduct);
  router.put('/products/:productId', ...guards.oversee, controller.setProduct);
  router.delete('/:id', ...guards.oversee, controller.remove);

  return router;
}
