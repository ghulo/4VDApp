import type { Request, Response } from 'express';
import { z } from 'zod';
import type { ThreadService } from '../services/ThreadService.js';
import { THREAD_SUBJECTS } from '../services/ThreadService.js';
import type { VatService } from '../services/vat/VatService.js';
import { bookHtml, bookSheet, ediBook, withholdingSheet, yearSheet } from '../services/vat/vatExport.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { toCsv } from '../utils/csv.js';
import { type Sheet, sheetToXlsx } from '../utils/spreadsheet.js';
import { exportTimeZoneSchema } from '../validators/reportValidators.js';
import { idSchema, parseInput } from '../validators/validate.js';

const monthParams = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be a month like 2026-09') });
const yearParams = z.object({ year: z.coerce.number().int().min(2000).max(2100) });
const money = z.coerce.number().min(0).max(100_000_000);
const typedSchema = z.object({ refund: money.optional(), carriedIn: money.nullable().optional() });
const reopenSchema = z.object({ reason: z.string().trim().min(3, 'say why the month is being reopened').max(500) });

const downloadSchema = z
  .object({
    lang: z.enum(['sq', 'en']).default('sq'),
    all: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .extend(exportTimeZoneSchema.shape);
const bookParams = monthParams.extend({ kind: z.enum(['sales', 'purchases']) });
const bookQuery = downloadSchema.extend({ format: z.enum(['xlsx', 'html', 'edi']).default('xlsx') });

const threadParams = z.object({ kind: z.enum(THREAD_SUBJECTS), id: idSchema });
const noteSchema = z.object({ body: z.string().trim().min(1, 'write something first').max(2000) });

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// oxlint-disable-next-line typescript/no-explicit-any
async function sendXlsx(res: Response, file: { basename: string; sheet: Sheet<any> }, timeZone: string): Promise<void> {
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.basename)}.xlsx"; filename*=UTF-8''${encodeURIComponent(file.basename)}.xlsx`);
  res.setHeader('Content-Type', XLSX_TYPE);
  const madeAt = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone });
  res.send(await sheetToXlsx(file.sheet, madeAt));
}

/** The VAT month: its return, books and downloads, filing and reopening; and questions on documents. */
export function createVatController(vatService: VatService, threadService: ThreadService) {
  return {
    async filed(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await vatService.filed());
    },

    async year(req: Request, res: Response): Promise<void> {
      const { year } = parseInput(yearParams, req.params);
      sendSuccess(res, await vatService.year(year));
    },

    async exportYear(req: Request, res: Response): Promise<void> {
      const { year } = parseInput(yearParams, req.params);
      const { lang, tz } = parseInput(downloadSchema, req.query);
      await sendXlsx(res, yearSheet(await vatService.year(year), year, lang), tz);
    },

    async month(req: Request, res: Response): Promise<void> {
      const { month } = parseInput(monthParams, req.params);
      sendSuccess(res, await vatService.month(month));
    },

    async saveTyped(req: Request, res: Response): Promise<void> {
      const { month } = parseInput(monthParams, req.params);
      sendSuccess(res, await vatService.saveTyped(month, parseInput(typedSchema, req.body), req.user!.id), { message: 'Saved' });
    },

    async file(req: Request, res: Response): Promise<void> {
      const { month } = parseInput(monthParams, req.params);
      sendSuccess(res, await vatService.file(month, req.user!.id), { message: 'Month marked as filed' });
    },

    async reopen(req: Request, res: Response): Promise<void> {
      const { month } = parseInput(monthParams, req.params);
      const { reason } = parseInput(reopenSchema, req.body);
      sendSuccess(res, await vatService.reopen(month, reason, req.user!), { message: 'Month reopened' });
    },

    async withholding(req: Request, res: Response): Promise<void> {
      const { month } = parseInput(monthParams, req.params);
      sendSuccess(res, await vatService.withholding(month));
    },

    async exportWithholding(req: Request, res: Response): Promise<void> {
      const { month } = parseInput(monthParams, req.params);
      const { lang, tz } = parseInput(downloadSchema, req.query);
      await sendXlsx(res, withholdingSheet(await vatService.withholding(month), month, lang), tz);
    },

    /** The sales or purchase book: Excel, a page to print (or save as PDF), or the file for EDI. */
    async book(req: Request, res: Response): Promise<void> {
      const { month, kind } = parseInput(bookParams, req.params);
      const { lang, all, tz, format } = parseInput(bookQuery, req.query);
      const items = await vatService.items(month);
      if (format === 'xlsx') return sendXlsx(res, bookSheet(kind, items, month, lang, all), tz);
      if (format === 'html') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(bookHtml(kind, items, month, lang, all, await vatService.business()));
        return;
      }
      const edi = ediBook(kind, items);
      const name = `${edi.basename} ${month}.csv`;
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.send(toCsv(edi.columns, edi.rows));
    },

    async thread(req: Request, res: Response): Promise<void> {
      const { kind, id } = parseInput(threadParams, req.params);
      sendSuccess(res, await threadService.get(kind, id));
    },

    async addNote(req: Request, res: Response): Promise<void> {
      const { kind, id } = parseInput(threadParams, req.params);
      const { body } = parseInput(noteSchema, req.body);
      sendSuccess(res, await threadService.post(kind, id, body, req.user!), { statusCode: 201, message: 'Sent' });
    },
  };
}
