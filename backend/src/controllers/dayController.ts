import type { Request, Response } from 'express';
import { z } from 'zod';
import type { DayService } from '../services/DayService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { parseInput } from '../validators/validate.js';

const noExpensesSchema = z.object({ none: z.boolean() });

export function createDayController(dayService: DayService) {
  return {
    async today(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await dayService.today());
    },

    async setNoExpenses(req: Request, res: Response): Promise<void> {
      const { none } = parseInput(noExpensesSchema, req.body);
      sendSuccess(res, await dayService.setNoExpenses(none, req.user!.id));
    },
  };
}
