import { Router } from 'express';
import type { Container } from '../container.js';
import { createDocumentController } from '../controllers/documentController.js';

export function createDocumentRoutes({ documentService, guards }: Container): Router {
  const controller = createDocumentController(documentService);
  const router = Router();

  router.get('/', ...guards.oversee, controller.list);
  // Employees open, print and link the documents they issued; the service checks that.
  router.get('/:id', ...guards.staff, controller.get);
  router.get('/:id/print', ...guards.staff, controller.print);
  router.put('/:id/fiscal-receipt', ...guards.staff, controller.setFiscalReceipt);

  return router;
}
