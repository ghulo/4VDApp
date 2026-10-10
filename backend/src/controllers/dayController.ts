import type { Request, Response } from 'express';
import { z } from 'zod';
import type { DayService } from '../services/DayService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { parseInput } from '../validators/validate.js';

const daySchema = z.object({ date: z.string().optional() });
const noExpensesSchema = z.object({ none: z.boolean(), date: z.string().optional() });

export function createDayController(dayService: DayService) {
  return {
    async get(req: Request, res: Response): Promise<void> {
      const { date } = parseInput(daySchema, req.query);
      sendSuccess(res, await dayService.forDay(req.user!.role, date));
    },

    async setNoExpenses(req: Request, res: Response): Promise<void> {
      const { none, date } = parseInput(noExpensesSchema, req.body);
      sendSuccess(res, await dayService.setNoExpenses(none, req.user!.id, req.user!.role, date));
    },
  };
}
