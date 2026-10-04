import type { Request, Response } from 'express';
import type { ExpenseService } from '../services/ExpenseService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { newExpenseSchema } from '../validators/expenseValidators.js';
import { reportRangeSchema } from '../validators/reportValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

export function createExpenseController(expenseService: ExpenseService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const { startDate, endDate } = parseInput(reportRangeSchema, req.query);
      sendSuccess(res, await expenseService.list({ startDate, endDate }));
    },

    async add(req: Request, res: Response): Promise<void> {
      const expense = await expenseService.add(parseInput(newExpenseSchema, req.body), req.user!.id);
      sendSuccess(res, expense, { statusCode: 201, message: 'Expense added' });
    },

    async remove(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await expenseService.remove(id, req.user!.id);
      sendSuccess(res, null, { message: 'Expense removed' });
    },

    async recurring(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await expenseService.recurring());
    },

    async stopRepeating(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await expenseService.stopRepeating(id, req.user!.id);
      sendSuccess(res, null, { message: 'Stopped repeating' });
    },
  };
}
