import { Router } from 'express';
import type { Container } from '../container.js';
import { createAuthController } from '../controllers/authController.js';
import { createLoginRateLimiter } from '../middlewares/rateLimiter.js';

export function createAuthRoutes({ authService, guards }: Container): Router {
  const controller = createAuthController(authService);
  const router = Router();

  router.post('/login', createLoginRateLimiter(), controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', guards.authenticated, controller.logout);
  router.get('/me', guards.authenticated, controller.me);

  return router;
}
