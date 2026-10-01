import type { Request, Response } from 'express';
import type { ReportsService } from '../services/ReportsService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { profitQuerySchema, reportRangeSchema } from '../validators/reportValidators.js';
import { parseInput } from '../validators/validate.js';

export function createReportsController(reportsService: ReportsService) {
  return {
    async summary(req: Request, res: Response): Promise<void> {
      const { previous, ...range } = parseInput(reportRangeSchema, req.query);
      sendSuccess(res, await reportsService.summary(range, previous));
    },

    async team(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await reportsService.team(parseInput(reportRangeSchema, req.query)));
    },

    async profit(req: Request, res: Response): Promise<void> {
      const range = parseInput(reportRangeSchema, req.query);
      const { groupBy } = parseInput(profitQuerySchema, req.query);
      sendSuccess(res, await reportsService.profit(range, groupBy));
    },

    async reorderSuggestions(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await reportsService.reorderSuggestions());
    },

    async mySales(req: Request, res: Response): Promise<void> {
      const { previous, ...range } = parseInput(reportRangeSchema, req.query);
      sendSuccess(res, await reportsService.mySales(req.user!.id, range, previous));
    },
  };
}
