import { Router } from 'express';
import type { Container } from '../container.js';
import { createAttentionController } from '../controllers/attentionController.js';

export function createAttentionRoutes({ attentionService, guards }: Container): Router {
  const controller = createAttentionController(attentionService);
  const router = Router();

  // Everyone gets their own To do list; what is on it depends on their role.
  router.get('/', guards.authenticated, controller.get);

  return router;
}
