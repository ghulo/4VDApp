import type { Request, Response } from 'express';
import { z } from 'zod';
import { ACCOUNT_CLASSES, ACCOUNT_LINK_KEYS, CASH_FLOW_ACTIVITIES } from '../constants/chartOfAccounts.js';
import type { BooksService } from '../services/BooksService.js';
import { type BooksLanguage, cardSheet, journalSheet, ledgerSheet, trialBalanceSheet } from '../services/books/booksExport.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { type Sheet, sheetToXlsx } from '../utils/spreadsheet.js';
import { exportTimeZoneSchema } from '../validators/reportValidators.js';
import { calendarDaySchema, DEFAULT_PAGE_SIZE, idParamsSchema, idSchema, MAX_PAGE_SIZE, parseInput } from '../validators/validate.js';

const periodSchema = z
  .object({ from: calendarDaySchema, to: calendarDaySchema })
  .refine((period) => period.from <= period.to, { message: 'the first day must come before the last', path: ['from'] });

const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const journalSchema = z.intersection(
  periodSchema,
  z.object({
    search: z.string().trim().max(100).optional(),
    corrections: flag,
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  }),
);

const cardSchema = z.intersection(periodSchema, z.object({ corrections: flag }));

const accountNumber = z.string().trim().regex(/^\d{3,10}$/, 'must be 3 to 10 digits, like 6240');
const accountFields = {
  number: accountNumber,
  name: z.string().trim().min(1).max(200),
  accountClass: z.enum(ACCOUNT_CLASSES),
  type: z.string().trim().min(1).max(100),
  group: z.string().trim().min(1).max(200),
  cashFlow: z.enum(CASH_FLOW_ACTIVITIES).default('operating'),
};
const newAccountSchema = z.object(accountFields);
const accountUpdateSchema = z.object({ ...accountFields, cashFlow: z.enum(CASH_FLOW_ACTIVITIES), archived: z.boolean() }).partial();

const money = z.coerce.number().min(0).max(100_000_000);
const manualEntrySchema = z.object({
  date: calendarDaySchema,
  description: z.string().max(500),
  lines: z
    .array(
      z.object({
        accountId: idSchema,
        debit: money.default(0),
        credit: money.default(0),
        supplierId: idSchema.nullish(),
        customerId: idSchema.nullish(),
        memo: z.string().max(300).nullish(),
      }),
    )
    .max(200),
});

const settingsSchema = z.object({
  startDay: calendarDaySchema.optional(),
  links: z.partialRecord(z.enum(ACCOUNT_LINK_KEYS as [string, ...string[]]), idSchema).optional(),
});

const sourceSchema = z.object({
  source: z.enum(['bill', 'payment', 'expense', 'return', 'write_off', 'count', 'document', 'sale', 'move', 'tab_payment']),
  id: idSchema,
});

const exportSchema = z.intersection(
  periodSchema,
  z.object({ lang: z.enum(['sq', 'en']).default('sq') }).extend(exportTimeZoneSchema.shape),
);

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// oxlint-disable-next-line typescript/no-explicit-any
async function sendXlsx(res: Response, file: { basename: string; sheet: Sheet<any> }, timeZone: string): Promise<void> {
  res.setHeader('Content-Disposition', `attachment; filename="${file.basename}.xlsx"`);
  res.setHeader('Content-Type', XLSX_TYPE);
  const madeAt = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone });
  res.send(await sheetToXlsx(file.sheet, madeAt));
}

/** Every entry in the period, for a download: the journal without paging. */
const ALL_ENTRIES = 1_000_000;

export function createBooksController(booksService: BooksService) {
  return {
    async exportTrialBalance(req: Request, res: Response): Promise<void> {
      const { from, to, lang, tz } = parseInput(exportSchema, req.query);
      const { rows } = await booksService.trialBalance({ from, to });
      await sendXlsx(res, trialBalanceSheet(rows, { from, to }, lang as BooksLanguage), tz);
    },

    async exportJournal(req: Request, res: Response): Promise<void> {
      const { from, to, lang, tz } = parseInput(exportSchema, req.query);
      const { entries } = await booksService.journal({ from, to, search: null, withCorrections: true, limit: ALL_ENTRIES, offset: 0 });
      await sendXlsx(res, journalSheet(entries.reverse(), { from, to }, lang as BooksLanguage), tz);
    },

    async exportLedger(req: Request, res: Response): Promise<void> {
      const { from, to, lang, tz } = parseInput(exportSchema, req.query);
      await sendXlsx(res, ledgerSheet(await booksService.generalLedger({ from, to }), { from, to }, lang as BooksLanguage), tz);
    },

    async exportCard(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { from, to, lang, tz } = parseInput(exportSchema, req.query);
      const card = await booksService.accountCard(id, { from, to }, true);
      await sendXlsx(res, cardSheet(card, { from, to }, lang as BooksLanguage), tz);
    },

    async accounts(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await booksService.accounts());
    },

    async addAccount(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await booksService.addAccount(parseInput(newAccountSchema, req.body), req.user!.id), { statusCode: 201, message: 'Account added' });
    },

    async updateAccount(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await booksService.updateAccount(id, parseInput(accountUpdateSchema, req.body), req.user!.id), { message: 'Account saved' });
    },

    async card(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { from, to, corrections } = parseInput(cardSchema, req.query);
      sendSuccess(res, await booksService.accountCard(id, { from, to }, corrections));
    },

    async trialBalance(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await booksService.trialBalance(parseInput(periodSchema, req.query)));
    },

    async journal(req: Request, res: Response): Promise<void> {
      const { from, to, search, corrections, page, limit } = parseInput(journalSchema, req.query);
      const result = await booksService.journal({ from, to, search: search || null, withCorrections: corrections, limit, offset: (page - 1) * limit });
      sendSuccess(res, result.entries, { meta: { page, limit, total: result.total } });
    },

    async entry(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await booksService.entry(id));
    },

    async entriesFor(req: Request, res: Response): Promise<void> {
      const { source, id } = parseInput(sourceSchema, req.query);
      sendSuccess(res, await booksService.entriesFor(source, id));
    },

    async addEntry(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await booksService.addManualEntry(parseInput(manualEntrySchema, req.body), req.user!.id), { statusCode: 201, message: 'Entry saved' });
    },

    async reverseEntry(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await booksService.reverseManualEntry(id, req.user!.id), { statusCode: 201, message: 'Entry reversed' });
    },

    async settings(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await booksService.settings());
    },

    async updateSettings(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await booksService.updateSettings(parseInput(settingsSchema, req.body), req.user!.id), { message: 'Books settings saved' });
    },
  };
}
