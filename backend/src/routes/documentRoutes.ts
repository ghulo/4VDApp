import { Router } from 'express';
import type { Container } from '../container.js';
import { createDocumentController } from '../controllers/documentController.js';

export function createDocumentRoutes({ documentService, guards }: Container): Router {
  const controller = createDocumentController(documentService);
  const router = Router();

  router.get('/', ...guards.books, controller.list);
  // Employees open, print and link the documents they issued; the service checks that. The accountant reads them all.
  router.get('/:id', ...guards.documents, controller.get);
  router.get('/:id/print', ...guards.documents, controller.print);
  router.put('/:id/fiscal-receipt', ...guards.staff, controller.setFiscalReceipt);

  return router;
}
