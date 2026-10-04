import { Router } from 'express';
import type { Container } from '../container.js';
import { createCarwashController } from '../controllers/carwashController.js';

export function createCarwashRoutes({ carwashService, guards }: Container): Router {
  const controller = createCarwashController(carwashService);
  const router = Router();

  router.get('/', ...guards.oversee, controller.list);
  // Staff enter today's takings from the team app; the service keeps other days to managers.
  router.get('/today', ...guards.staff, controller.today);
  router.put('/:day', ...guards.staff, controller.save);
  router.delete('/:day', ...guards.manage, controller.remove);

  return router;
}
