import type { Request, Response } from 'express';
import type { BooksLanguage } from '../services/books/booksExport.js';
import type { MoneyService } from '../services/MoneyService.js';
import { placeBookSheet } from '../services/money/placeBookExport.js';
import type { StatementService } from '../services/StatementService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { sheetToXlsx } from '../utils/spreadsheet.js';
import {
  bookExportSchema,
  confirmSchema,
  linesQuerySchema,
  moveSchema,
  newPlaceSchema,
  payBillsSchema,
  periodSchema,
  placeChangesSchema,
  ruleSchema,
  skipSchema,
  uploadSchema,
} from '../validators/moneyValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function createMoneyController(moneyService: MoneyService, statementService: StatementService) {
  return {
    async places(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await moneyService.places());
    },

    async addPlace(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await moneyService.addPlace(parseInput(newPlaceSchema, req.body), req.user!.id), { statusCode: 201, message: 'Place added' });
    },

    async updatePlace(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await moneyService.updatePlace(id, parseInput(placeChangesSchema, req.body), req.user!.id), { message: 'Place saved' });
    },

    async book(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await moneyService.book(id, parseInput(periodSchema, req.query)));
    },

    async exportBook(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { from, to, lang, tz } = parseInput(bookExportSchema, req.query);
      const file = placeBookSheet(await moneyService.book(id, { from, to }), lang as BooksLanguage);
      res.setHeader('Content-Disposition', `attachment; filename="${file.basename}.xlsx"`);
      res.setHeader('Content-Type', XLSX_TYPE);
      const madeAt = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz });
      res.send(await sheetToXlsx(file.sheet, madeAt));
    },

    async move(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await moneyService.move(parseInput(moveSchema, req.body), req.user!.id), { statusCode: 201, message: 'Money moved' });
    },

    async voidMove(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await moneyService.voidMove(id, req.user!.id);
      sendSuccess(res, null, { message: 'Move removed' });
    },

    async payBills(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await moneyService.payBills(parseInput(payBillsSchema, req.body), req.user!.id), { statusCode: 201, message: 'Bills paid' });
    },

    async upload(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const result = await statementService.upload(id, parseInput(uploadSchema, req.body), req.user!.id);
      sendSuccess(res, result, { statusCode: result.needsLayout ? 200 : 201, message: result.needsLayout ? 'Say which column is which' : 'Statement uploaded' });
    },

    async statements(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await statementService.statements(id));
    },

    async lines(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { status } = parseInput(linesQuerySchema, req.query);
      sendSuccess(res, await statementService.lines(id, status));
    },

    async confirmSure(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await statementService.confirmSure(id, req.user!.id), { message: 'Sure matches confirmed' });
    },

    async confirm(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const input = parseInput(confirmSchema, req.body);
      await statementService.confirm(id, input.action, req.user!.id, { rule: input.rule, ruleId: input.ruleId });
      sendSuccess(res, null, { message: 'Line matched' });
    },

    async undo(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await statementService.undo(id, req.user!.id);
      sendSuccess(res, null, { message: 'Match taken back' });
    },

    async skip(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { skipped } = parseInput(skipSchema, req.body);
      await statementService.skip(id, skipped, req.user!.id);
      sendSuccess(res, null, { message: skipped ? 'Line left out' : 'Line brought back' });
    },

    async rules(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await statementService.rules());
    },

    async addRule(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await statementService.saveRule(null, parseInput(ruleSchema, req.body), req.user!.id), { statusCode: 201, message: 'Rule saved' });
    },

    async updateRule(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await statementService.saveRule(id, parseInput(ruleSchema, req.body), req.user!.id), { message: 'Rule saved' });
    },

    async removeRule(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await statementService.removeRule(id, req.user!.id);
      sendSuccess(res, null, { message: 'Rule removed' });
    },
  };
}
