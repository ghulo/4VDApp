import { Router } from 'express';
import type { Container } from '../container.js';
import { createStockDocumentController } from '../controllers/stockDocumentController.js';

/** Stock in and stock out documents: read with the books, written by those who change stock by hand. */
export function createStockDocumentRoutes({ stockDocumentService, guards }: Container): Router {
  const controller = createStockDocumentController(stockDocumentService);
  const router = Router();

  router.get('/', ...guards.books, controller.list);
  router.post('/', ...guards.manage, controller.create);
  router.get('/:id', ...guards.books, controller.get);
  router.post('/:id/void', ...guards.manage, controller.void);

  return router;
}
