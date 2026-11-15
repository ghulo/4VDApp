import { Router } from 'express';
import type { Container } from '../container.js';
import { createAssetController } from '../controllers/assetController.js';

/** The fixed assets register: read with the books, kept by whoever writes entries (managers and the accountant). */
export function createAssetRoutes({ fixedAssetService, guards }: Container): Router {
  const controller = createAssetController(fixedAssetService);
  const router = Router();

  router.get('/', ...guards.books, controller.list);
  router.get('/download', ...guards.books, controller.exportRegister);
  router.get('/opening', ...guards.books, controller.opening);
  router.get('/check', ...guards.books, controller.booksCheck);
  router.get('/schedule/:year', ...guards.books, controller.schedule);
  router.get('/schedule/:year/download', ...guards.books, controller.exportSchedule);
  router.post('/', ...guards.entries, controller.create);
  router.get('/:id', ...guards.books, controller.get);
  router.patch('/:id', ...guards.entries, controller.update);
  router.delete('/:id', ...guards.entries, controller.remove);
  router.post('/:id/split', ...guards.entries, controller.split);
  router.post('/:id/dispose', ...guards.entries, controller.dispose);
  router.post('/:id/undo-disposal', ...guards.entries, controller.undoDisposal);

  return router;
}
