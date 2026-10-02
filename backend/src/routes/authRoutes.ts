import { Router } from 'express';
import type { Container } from '../container.js';
import { createAuthController } from '../controllers/authController.js';
import { createInviteController } from '../controllers/inviteController.js';
import { createLoginRateLimiter } from '../middlewares/rateLimiter.js';

export function createAuthRoutes({ authService, inviteService, guards }: Container): Router {
  const controller = createAuthController(authService);
  const invites = createInviteController(inviteService);
  const router = Router();
  // Public links from emails share the failed-login limit, which slows guessing.
  const linkLimiter = createLoginRateLimiter();

  router.post('/login', createLoginRateLimiter(), controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', guards.authenticated, controller.logout);
  router.get('/me', guards.authenticated, controller.me);
  router.get('/invites/:token', linkLimiter, invites.preview);
  router.post('/invites/:token/accept', linkLimiter, invites.accept);

  return router;
}
