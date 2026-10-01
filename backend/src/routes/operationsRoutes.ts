import { Router } from 'express';
import type { Container } from '../container.js';
import {
  createAnalyticsController,
  createFavoriteController,
  createNotificationController,
  createSalesController,
  createUserController,
} from '../controllers/operationsControllers.js';

export function createSalesRoutes({ salesService, guards }: Container): Router {
  const controller = createSalesController(salesService);
  const router = Router();

  router.get('/', ...guards.admin, controller.list);
  // Employees record sales too; only admins see the full history.
  router.post('/', ...guards.staff, controller.record);

  return router;
}

export function createAnalyticsRoutes({ analyticsService, guards }: Container): Router {
  const controller = createAnalyticsController(analyticsService);
  const router = Router();

  router.use(...guards.admin);
  router.get('/dashboard', controller.dashboard);
  router.get('/revenue', controller.revenue);
  router.get('/products/:productId', controller.product);

  return router;
}

export function createUserRoutes({ userService, guards }: Container): Router {
  const controller = createUserController(userService);
  const router = Router();

  router.use(...guards.admin);
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.put('/:id', controller.update);
  router.delete('/:id', controller.remove);

  return router;
}

export function createNotificationRoutes({ notificationService, guards }: Container): Router {
  const controller = createNotificationController(notificationService);
  const router = Router();

  router.use(guards.authenticated);
  router.get('/', controller.list);
  router.post('/read-all', controller.markAllRead);
  router.patch('/:id/read', controller.markRead);

  return router;
}

export function createFavoriteRoutes({ favoriteService, guards }: Container): Router {
  const controller = createFavoriteController(favoriteService);
  const router = Router();

  router.use(guards.authenticated);
  router.get('/', controller.list);
  router.get('/ids', controller.listIds);
  router.put('/:productId', controller.add);
  router.delete('/:productId', controller.remove);

  return router;
}
