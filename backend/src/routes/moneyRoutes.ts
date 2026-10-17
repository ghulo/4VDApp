import { Router } from 'express';
import type { Container } from '../container.js';
import { createMoneyController } from '../controllers/moneyController.js';

/** Where money is kept: whoever oversees the business and the accountant read the books; the people who run the shop move money and match statements. */
export function createMoneyRoutes({ moneyService, statementService, guards }: Container): Router {
  const controller = createMoneyController(moneyService, statementService);
  const router = Router();

  router.get('/places', ...guards.books, controller.places);
  router.post('/places', ...guards.oversee, controller.addPlace);
  router.patch('/places/:id', ...guards.oversee, controller.updatePlace);
  router.get('/places/:id/book', ...guards.books, controller.book);
  router.get('/places/:id/book.xlsx', ...guards.books, controller.exportBook);
  router.get('/places/:id/statements', ...guards.books, controller.statements);
  router.post('/places/:id/statements', ...guards.oversee, controller.upload);
  router.get('/places/:id/lines', ...guards.books, controller.lines);
  router.post('/places/:id/confirm-sure', ...guards.oversee, controller.confirmSure);
  router.post('/lines/:id/confirm', ...guards.oversee, controller.confirm);
  router.post('/lines/:id/undo', ...guards.oversee, controller.undo);
  router.post('/lines/:id/skip', ...guards.oversee, controller.skip);
  router.post('/moves', ...guards.oversee, controller.move);
  router.post('/moves/:id/void', ...guards.oversee, controller.voidMove);
  router.post('/pay-bills', ...guards.oversee, controller.payBills);
  router.get('/rules', ...guards.books, controller.rules);
  router.post('/rules', ...guards.oversee, controller.addRule);
  router.put('/rules/:id', ...guards.oversee, controller.updateRule);
  router.delete('/rules/:id', ...guards.oversee, controller.removeRule);

  return router;
}
