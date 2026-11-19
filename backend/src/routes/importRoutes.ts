import { Router } from 'express';
import type { Container } from '../container.js';
import { createImportController } from '../controllers/importController.js';

/** Settings → Import: bringing data in from another program, and undoing it. Only those with the import power. */
export function createImportRoutes({ importService, guards }: Container): Router {
  const controller = createImportController(importService);
  const router = Router();

  router.get('/template', ...guards.import, controller.template);
  router.post('/wanted', ...guards.import, controller.wanted);
  router.get('/', ...guards.import, controller.list);
  router.post('/', ...guards.import, controller.create);
  router.get('/:id', ...guards.import, controller.get);
  router.put('/:id/choices', ...guards.import, controller.setChoices);
  router.post('/:id/run', ...guards.import, controller.run);
  router.delete('/:id', ...guards.import, controller.discard);
  router.get('/:id/undo', ...guards.import, controller.undoPlan);
  router.post('/:id/undo', ...guards.import, controller.undo);
  router.get('/:id/spot-check', ...guards.import, controller.spotCheck);
  router.post('/:id/checked', ...guards.import, controller.markChecked);
  router.get('/:id/problems.xlsx', ...guards.import, controller.problemRows);

  return router;
}
