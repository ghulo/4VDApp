import { Router } from 'express';
import type { Container } from '../container.js';
import { createBooksController } from '../controllers/booksController.js';
import { createOpeningController } from '../controllers/openingController.js';

/** The books: whoever oversees the business and the accountant read them; managers and the accountant write entries; managers change the chart. */
export function createBooksRoutes({ booksService, openingService, guards }: Container): Router {
  const controller = createBooksController(booksService);
  const opening = createOpeningController(openingService);
  const router = Router();

  router.get('/accounts', ...guards.books, controller.accounts);
  router.post('/accounts', ...guards.manage, controller.addAccount);
  router.patch('/accounts/:id', ...guards.manage, controller.updateAccount);
  router.get('/accounts/:id/card', ...guards.books, controller.card);
  router.get('/trial-balance', ...guards.books, controller.trialBalance);
  router.get('/journal', ...guards.books, controller.journal);
  router.get('/entries', ...guards.books, controller.entriesFor);
  router.post('/entries', ...guards.entries, controller.addEntry);
  router.get('/entries/:id', ...guards.books, controller.entry);
  router.post('/entries/:id/reverse', ...guards.entries, controller.reverseEntry);
  router.get('/trial-balance.xlsx', ...guards.books, controller.exportTrialBalance);
  router.get('/journal.xlsx', ...guards.books, controller.exportJournal);
  router.get('/ledger.xlsx', ...guards.books, controller.exportLedger);
  router.get('/accounts/:id/card.xlsx', ...guards.books, controller.exportCard);
  router.get('/settings', ...guards.books, controller.settings);
  router.put('/settings', ...guards.manage, controller.updateSettings);

  // Opening balances: whoever writes entries checks, confirms and posts them.
  router.get('/opening', ...guards.books, opening.view);
  router.post('/opening/lines', ...guards.entries, opening.addLine);
  router.patch('/opening/lines/:id', ...guards.entries, opening.updateLine);
  router.delete('/opening/lines/:id', ...guards.entries, opening.removeLine);
  router.post('/opening/confirm', ...guards.entries, opening.confirm);
  router.post('/opening/post', ...guards.entries, opening.post);
  router.post('/opening/take-back', ...guards.entries, opening.takeBack);

  return router;
}
