import { Router } from 'express';
import type { Container } from '../container.js';
import { createBooksController } from '../controllers/booksController.js';

/** The books: whoever oversees the business reads them; managers write entries and change the chart. */
export function createBooksRoutes({ booksService, guards }: Container): Router {
  const controller = createBooksController(booksService);
  const router = Router();

  router.get('/accounts', ...guards.oversee, controller.accounts);
  router.post('/accounts', ...guards.manage, controller.addAccount);
  router.patch('/accounts/:id', ...guards.manage, controller.updateAccount);
  router.get('/accounts/:id/card', ...guards.oversee, controller.card);
  router.get('/trial-balance', ...guards.oversee, controller.trialBalance);
  router.get('/journal', ...guards.oversee, controller.journal);
  router.get('/entries', ...guards.oversee, controller.entriesFor);
  router.post('/entries', ...guards.manage, controller.addEntry);
  router.get('/entries/:id', ...guards.oversee, controller.entry);
  router.post('/entries/:id/reverse', ...guards.manage, controller.reverseEntry);
  router.get('/trial-balance.xlsx', ...guards.oversee, controller.exportTrialBalance);
  router.get('/journal.xlsx', ...guards.oversee, controller.exportJournal);
  router.get('/ledger.xlsx', ...guards.oversee, controller.exportLedger);
  router.get('/accounts/:id/card.xlsx', ...guards.oversee, controller.exportCard);
  router.get('/settings', ...guards.oversee, controller.settings);
  router.put('/settings', ...guards.manage, controller.updateSettings);

  return router;
}
