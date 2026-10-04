import type { Request, Response } from 'express';
import type { CashCountService } from '../services/CashCountService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { canOversee } from '../utils/roles.js';
import { cashCountSchema } from '../validators/cashCountValidators.js';
import { reportRangeSchema } from '../validators/reportValidators.js';
import { parseInput } from '../validators/validate.js';

export function createCashCountController(cashCountService: CashCountService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const { startDate, endDate } = parseInput(reportRangeSchema, req.query);
      sendSuccess(res, await cashCountService.list({ startDate, endDate }));
    },

    async today(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await cashCountService.today());
    },

    async count(req: Request, res: Response): Promise<void> {
      const user = req.user!;
      const result = await cashCountService.count(parseInput(cashCountSchema, req.body), { id: user.id, name: user.name });
      // Staff count blind: only the people who check the money see how it came out.
      sendSuccess(res, canOversee(user.role) ? result : null, { statusCode: 201, message: 'Cash counted' });
    },
  };
}
