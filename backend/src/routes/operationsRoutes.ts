import { createAuthController } from '../controllers/authController.js';
import { Router } from 'express';
import type { Container } from '../container.js';
import { createReturnsController } from '../controllers/returnsController.js';
import { createSessionController } from '../controllers/sessionController.js';
import { createPasskeyController } from '../controllers/passkeyController.js';
import {
  createAnalyticsController,
  createFavoriteController,
  createNotificationController,
  createSalesController,
  createUserController,
} from '../controllers/operationsControllers.js';

export function createSalesRoutes({ salesService, returnService, guards }: Container): Router {
  const controller = createSalesController(salesService);
  const returns = createReturnsController(returnService);
  const router = Router();

  router.get('/', ...guards.books, controller.list);
  router.get('/checkouts', ...guards.books, controller.checkouts);
  // Everyone sees their own checkouts, to find a sale again and start a return from it.
  router.get('/checkouts/mine', ...guards.staff, controller.myCheckouts);
  // Employees record sales too; only the people who run the shop see the full history.
  router.post('/', ...guards.staff, controller.record);
  router.post('/basket', ...guards.staff, controller.recordBasket);
  // Employees may return only their own sales; the service checks that.
  router.post('/:saleId/returns', ...guards.staff, returns.request);

  return router;
}

export function createAnalyticsRoutes({ analyticsService, guards }: Container): Router {
  const controller = createAnalyticsController(analyticsService);
  const router = Router();

  router.use(...guards.oversee);
  router.get('/dashboard', controller.dashboard);
  router.get('/revenue', controller.revenue);
  router.get('/products/:productId', controller.product);

  return router;
}

export function createUserRoutes({ userService, sessionService, authService, twoStepService, passkeyService, guards, config }: Container): Router {
  const controller = createUserController(userService);
  const auth = createAuthController(authService, twoStepService, config.refreshTokenTtlDays);
  const sessions = createSessionController(sessionService);
  const router = Router();

  // The owner may see who works here; only managers change it (UserService checks who may touch whom).
  // People join only by invite (email or a shared link), never with a password someone else typed.
  router.get('/', ...guards.oversee, controller.list);
  router.get('/:id/sessions', ...guards.oversee, sessions.ofUser);
  router.put('/:id', ...guards.manage, controller.update);
  router.delete('/:id', ...guards.manage, controller.remove);
  // Lost phone and backup codes: a manager switches two-step sign-in off for them.
  router.post('/:id/two-step/reset', ...guards.manage, auth.twoStepReset);
  // A lost or shared device: a manager removes someone's passkeys.
  router.post('/:id/passkeys/reset', ...guards.manage, createPasskeyController(passkeyService, config.refreshTokenTtlDays).reset);

  return router;
}

export function createNotificationRoutes({ notificationService, pushService, guards }: Container): Router {
  const controller = createNotificationController(notificationService, pushService);
  const router = Router();

  router.use(guards.authenticated);
  router.get('/', controller.list);
  router.get('/push', controller.pushSettings);
  router.put('/push/preferences', controller.updatePushPreferences);
  router.post('/push/devices', controller.addPushDevice);
  router.post('/push/test', controller.sendTestPush);
  // DELETE with a body: the token is a long URL, too awkward for the path.
  router.delete('/push/devices', controller.removePushDevice);
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
