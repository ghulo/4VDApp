import { Router } from 'express';
import type { Container } from '../container.js';
import { createAccountController } from '../controllers/accountController.js';

/** The signed-in person's own account. */
export function createMeRoutes({ accountService, guards }: Container): Router {
  const account = createAccountController(accountService);
  const router = Router();

  router.use(guards.authenticated);
  router.post('/password', account.changePassword);
  router.post('/email', account.changeEmail);

  return router;
}
