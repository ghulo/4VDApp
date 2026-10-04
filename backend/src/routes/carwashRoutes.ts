import { Router } from 'express';
import type { Container } from '../container.js';
import { createCarwashController } from '../controllers/carwashController.js';

export function createCarwashRoutes({ carwashService, guards }: Container): Router {
  const controller = createCarwashController(carwashService);
  const router = Router();

  router.get('/', ...guards.oversee, controller.list);
  router.put('/:day', ...guards.manage, controller.save);
  router.delete('/:day', ...guards.manage, controller.remove);

  return router;
}
