import type { Request, Response } from 'express';
import { z } from 'zod';
import type { DatabaseClient } from '../database/connection.js';
import type { StatementsService } from '../services/statements/StatementsService.js';
import { type StatementData, statementHtml, statementSheet } from '../services/statements/statementsExport.js';
import type { YearService } from '../services/statements/YearService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { type Sheet, sheetToXlsx } from '../utils/spreadsheet.js';
import { zonedDay } from '../utils/zonedDates.js';
import { exportTimeZoneSchema } from '../validators/reportValidators.js';
import { calendarDaySchema, idParamsSchema, idSchema, parseInput } from '../validators/validate.js';

const kindParams = z.object({ kind: z.enum(['balance', 'income', 'equity', 'cashflow']) });

/** The period (a balance sheet reads only `to`, as its day) and an optional one to compare with. */
const statementQuery = z
  .object({
    from: calendarDaySchema,
    to: calendarDaySchema,
    compareFrom: calendarDaySchema.optional(),
    compareTo: calendarDaySchema.optional(),
  })
  .refine((query) => query.from <= query.to, { message: 'the first day must come before the last', path: ['from'] })
  .refine((query) => !query.compareFrom || !query.compareTo || query.compareFrom <= query.compareTo, { message: 'the first day must come before the last', path: ['compareFrom'] });

const downloadQuery = z.intersection(
  statementQuery,
  z
    .object({ lang: z.enum(['sq', 'en']).default('sq'), format: z.enum(['xlsx', 'html']).default('xlsx'), finish: z.enum(['official', 'bank']).default('official') })
    .extend(exportTimeZoneSchema.shape),
);

const yearParams = z.object({ year: z.coerce.number().int().min(2000).max(2200) });
const closeBody = z.object({ tax: z.coerce.number().min(0).max(100_000_000).optional() });
const reopenBody = z.object({ reason: z.string().max(500) });
const payBody = z.object({
  quarter: z.coerce.number().int().min(1).max(4),
  amount: z.coerce.number().min(0).max(100_000_000),
  day: calendarDaySchema,
  placeId: idSchema,
  note: z.string().max(300).nullish(),
});

const inputsBody = z.object({
  previousTax: z.coerce.number().min(0).max(100_000_000).nullable(),
  // A loss before the books start is a negative profit.
  profitBefore: z.coerce.number().min(-100_000_000).max(100_000_000).nullable(),
});

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function createStatementsController(statements: StatementsService, years: YearService, db: DatabaseClient) {
  async function load(kind: StatementData['kind'], query: z.output<typeof statementQuery>): Promise<StatementData> {
    const compare = query.compareFrom && query.compareTo ? { from: query.compareFrom, to: query.compareTo } : null;
    const period = { from: query.from, to: query.to };
    switch (kind) {
      case 'balance':
        return { kind, data: await statements.balanceSheet(query.to, query.compareTo ?? null) };
      case 'income':
        return { kind, data: await statements.incomeStatement(period, compare) };
      case 'cashflow':
        return { kind, data: await statements.cashFlow(period, compare) };
      case 'equity':
        return { kind, data: await statements.equityChanges(period) };
    }
  }

  return {
    async statement(req: Request, res: Response): Promise<void> {
      const { kind } = parseInput(kindParams, req.params);
      sendSuccess(res, (await load(kind, parseInput(statementQuery, req.query))).data);
    },

    async download(req: Request, res: Response): Promise<void> {
      const { kind } = parseInput(kindParams, req.params);
      const query = parseInput(downloadQuery, req.query);
      const statement = await load(kind, query);
      if (query.format === 'html') {
        const business = await db.selectFrom('businesses').select(['name', 'nui', 'address']).orderBy('id').executeTakeFirst();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(statementHtml(statement, query.lang, query.finish, { name: business?.name ?? '4VD', nui: business?.nui ?? null, address: business?.address ?? null }, zonedDay(new Date(), query.tz)));
        return;
      }
      const file = statementSheet(statement, query.lang);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.basename)}.xlsx"; filename*=UTF-8''${encodeURIComponent(`${file.basename}.xlsx`)}`);
      res.setHeader('Content-Type', XLSX_TYPE);
      const madeAt = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: query.tz });
      // oxlint-disable-next-line typescript/no-explicit-any
      res.send(await sheetToXlsx(file.sheet as Sheet<any>, madeAt));
    },

    async year(req: Request, res: Response): Promise<void> {
      const { year } = parseInput(yearParams, req.params);
      sendSuccess(res, await years.year(year, req.user!.role));
    },

    async close(req: Request, res: Response): Promise<void> {
      const { year } = parseInput(yearParams, req.params);
      sendSuccess(res, await years.close(year, parseInput(closeBody, req.body), req.user!), { message: 'Year closed' });
    },

    async reopen(req: Request, res: Response): Promise<void> {
      const { year } = parseInput(yearParams, req.params);
      sendSuccess(res, await years.reopen(year, parseInput(reopenBody, req.body).reason, req.user!), { message: 'Year reopened' });
    },

    async pay(req: Request, res: Response): Promise<void> {
      const { year } = parseInput(yearParams, req.params);
      const { quarter, ...input } = parseInput(payBody, req.body);
      sendSuccess(res, await years.pay(year, quarter, input, req.user!), { statusCode: 201, message: 'Instalment saved' });
    },

    async inputs(req: Request, res: Response): Promise<void> {
      const { year } = parseInput(yearParams, req.params);
      sendSuccess(res, await years.setInputs(year, parseInput(inputsBody, req.body), req.user!), { message: 'Saved' });
    },

    async undo(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await years.undo(id, req.user!), { message: 'Instalment taken back' });
    },
  };
}
