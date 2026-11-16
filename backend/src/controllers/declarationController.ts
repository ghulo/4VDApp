import type { Request, Response } from 'express';
import { z } from 'zod';
import type { DatabaseClient } from '../database/connection.js';
import type { DeclarationService } from '../services/statements/DeclarationService.js';
import { declarationHtml, declarationSheet } from '../services/statements/declarationExport.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { sheetToXlsx } from '../utils/spreadsheet.js';
import { zonedDay } from '../utils/zonedDates.js';
import { exportTimeZoneSchema } from '../validators/reportValidators.js';
import { calendarDaySchema, idSchema, parseInput } from '../validators/validate.js';

const yearParams = z.object({ year: z.coerce.number().int().min(2000).max(2200) });
const money = z.coerce.number().min(0).max(100_000_000);
const inputsBody = z.object({
  includeCarwash: z.boolean(),
  representation: money.nullable(),
  donations: money.nullable(),
  fines: money,
  // An "other" line can add to the profit or take from it.
  other: z.array(z.object({ label: z.string().trim().min(1).max(120), amount: z.coerce.number().min(-100_000_000).max(100_000_000) })).max(20),
  earlierLosses: z.array(z.object({ year: z.coerce.number().int().min(2000).max(2200), amount: money.refine((value) => value > 0, 'type the loss as a positive amount') })).max(6),
});
const fileBody = z.object({ day: calendarDaySchema });
const reopenBody = z.object({ reason: z.string().max(500) });
const payBody = z.object({ amount: money, day: calendarDaySchema, placeId: idSchema, note: z.string().max(300).nullish() });
const downloadQuery = z.object({ lang: z.enum(['sq', 'en']).default('sq'), format: z.enum(['xlsx', 'html']).default('xlsx') }).extend(exportTimeZoneSchema.shape);

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function createDeclarationController(declarations: DeclarationService, db: DatabaseClient) {
  return {
    async get(req: Request, res: Response): Promise<void> {
      const { year } = parseInput(yearParams, req.params);
      sendSuccess(res, await declarations.declaration(year));
    },

    async inputs(req: Request, res: Response): Promise<void> {
      const { year } = parseInput(yearParams, req.params);
      sendSuccess(res, await declarations.setInputs(year, parseInput(inputsBody, req.body), req.user!), { message: 'Saved' });
    },

    async file(req: Request, res: Response): Promise<void> {
      const { year } = parseInput(yearParams, req.params);
      sendSuccess(res, await declarations.file(year, parseInput(fileBody, req.body).day, req.user!), { message: 'Marked as filed' });
    },

    async reopen(req: Request, res: Response): Promise<void> {
      const { year } = parseInput(yearParams, req.params);
      sendSuccess(res, await declarations.reopen(year, parseInput(reopenBody, req.body).reason, req.user!), { message: 'Declaration reopened' });
    },

    async pay(req: Request, res: Response): Promise<void> {
      const { year } = parseInput(yearParams, req.params);
      sendSuccess(res, await declarations.payRest(year, parseInput(payBody, req.body), req.user!), { statusCode: 201, message: 'Payment saved' });
    },

    async download(req: Request, res: Response): Promise<void> {
      const { year } = parseInput(yearParams, req.params);
      const query = parseInput(downloadQuery, req.query);
      const data = await declarations.declaration(year);
      if (query.format === 'html') {
        const business = await db.selectFrom('businesses').select(['name', 'nui', 'address']).orderBy('id').executeTakeFirst();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(declarationHtml(data, query.lang, { name: business?.name ?? '4VD', nui: business?.nui ?? null, address: business?.address ?? null }, zonedDay(new Date(), query.tz)));
        return;
      }
      const file = declarationSheet(data, query.lang);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.basename)}.xlsx"; filename*=UTF-8''${encodeURIComponent(`${file.basename}.xlsx`)}`);
      res.setHeader('Content-Type', XLSX_TYPE);
      const madeAt = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: query.tz });
      res.send(await sheetToXlsx(file.sheet, madeAt));
    },
  };
}
