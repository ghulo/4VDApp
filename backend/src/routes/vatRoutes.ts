import { Router } from 'express';
import type { Container } from '../container.js';
import { createVatController } from '../controllers/vatController.js';

/** VAT months and questions on documents: the accountant and whoever oversees the business. Reopening is checked in the service. */
export function createVatRoutes({ vatService, threadService, guards }: Container): Router {
  const controller = createVatController(vatService, threadService);
  const router = Router();

  router.get('/filed', ...guards.books, controller.filed);
  router.get('/year/:year', ...guards.books, controller.year);
  router.get('/year/:year/download', ...guards.books, controller.exportYear);
  router.get('/:month', ...guards.books, controller.month);
  router.put('/:month', ...guards.filing, controller.saveTyped);
  router.post('/:month/file', ...guards.filing, controller.file);
  router.post('/:month/reopen', ...guards.books, controller.reopen);
  router.get('/:month/withholding', ...guards.books, controller.withholding);
  router.get('/:month/withholding/download', ...guards.books, controller.exportWithholding);
  router.get('/:month/books/:kind', ...guards.books, controller.book);

  return router;
}

/** Questions the accountant leaves on a bill, an invoice or an entry, and the shop's answers. */
export function createThreadRoutes({ vatService, threadService, guards }: Container): Router {
  const controller = createVatController(vatService, threadService);
  const router = Router();

  router.get('/:kind/:id', ...guards.books, controller.thread);
  router.post('/:kind/:id', ...guards.books, controller.addNote);

  return router;
}
