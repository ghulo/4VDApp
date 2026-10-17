import { Router } from 'express';
import type { Container } from '../container.js';
import { createBooksController } from '../controllers/booksController.js';

/** The books: whoever oversees the business and the accountant read them; managers and the accountant write entries; managers change the chart. */
export function createBooksRoutes({ booksService, guards }: Container): Router {
  const controller = createBooksController(booksService);
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

  return router;
}
