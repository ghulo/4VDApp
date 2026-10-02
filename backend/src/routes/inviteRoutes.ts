import { Router } from 'express';
import type { Container } from '../container.js';
import { createInviteController } from '../controllers/inviteController.js';

/** The owner's side: invite, list, resend, cancel. */
export function createInviteRoutes({ inviteService, guards }: Container): Router {
  const controller = createInviteController(inviteService);
  const router = Router();

  router.use(...guards.manage);
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.post('/:id/resend', controller.resend);
  router.delete('/:id', controller.cancel);

  return router;
}
