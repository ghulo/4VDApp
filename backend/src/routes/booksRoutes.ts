import { Router } from 'express';
import type { Container } from '../container.js';
import { createBooksController } from '../controllers/booksController.js';
import { createOpeningController } from '../controllers/openingController.js';
import { createStatementsController } from '../controllers/statementsController.js';

/** The books: whoever oversees the business and the accountant read them; managers and the accountant write entries; managers change the chart. */
export function createBooksRoutes({ booksService, openingService, statementsService, yearService, db, guards }: Container): Router {
  const controller = createBooksController(booksService);
  const opening = createOpeningController(openingService);
  const statements = createStatementsController(statementsService, yearService, db);
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
  router.get('/trefin-entries/:id', ...guards.books, controller.trefinEntry);
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

  // Statements are read by whoever reads the books. Closing and reopening a year is checked in the
  // service (like reopening a VAT month); instalments are recorded by whoever files VAT.
  router.get('/statements/:kind', ...guards.books, statements.statement);
  router.get('/statements/:kind/download', ...guards.books, statements.download);
  router.get('/year/:year', ...guards.books, statements.year);
  router.post('/year/:year/close', ...guards.books, statements.close);
  router.post('/year/:year/reopen', ...guards.books, statements.reopen);
  router.post('/year/:year/instalments', ...guards.filing, statements.pay);
  router.delete('/instalments/:id', ...guards.filing, statements.undo);

  return router;
}
