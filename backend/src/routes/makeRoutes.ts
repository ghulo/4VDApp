import { Router } from 'express';
import type { Container } from '../container.js';
import { createMakeController } from '../controllers/makeController.js';

/** Made products: recipes and Make documents, read by anyone signed in, set up and made by those who oversee the shop. */
export function createMakeRoutes({ makeService, guards }: Container): Router {
  const controller = createMakeController(makeService);
  const router = Router();

  router.get('/', guards.authenticated, controller.list);
  router.get('/plan', guards.authenticated, controller.plan);
  router.post('/', ...guards.oversee, controller.create);
  router.get('/recipes/:productId', guards.authenticated, controller.recipe);
  router.put('/recipes/:productId', ...guards.oversee, controller.setRecipe);
  router.get('/:id', guards.authenticated, controller.get);
  router.post('/:id/void', ...guards.oversee, controller.void);

  return router;
}
