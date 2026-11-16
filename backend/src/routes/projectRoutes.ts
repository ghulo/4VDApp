import { Router } from 'express';
import type { Container } from '../container.js';
import { createProjectController } from '../controllers/projectController.js';

/** Projects: listed for the pickers to anyone signed in; set up and tagged by those who oversee the shop; the profit report is on the money side. */
export function createProjectRoutes({ projectService, guards }: Container): Router {
  const controller = createProjectController(projectService);
  const router = Router();

  router.get('/', guards.authenticated, controller.list);
  router.post('/', ...guards.oversee, controller.create);
  router.put('/tag', ...guards.oversee, controller.tag);
  router.get('/profit', ...guards.books, controller.profit);
  router.patch('/:id', ...guards.oversee, controller.update);
  router.delete('/:id', ...guards.oversee, controller.remove);
  router.get('/:id/documents', ...guards.books, controller.documents);

  return router;
}
