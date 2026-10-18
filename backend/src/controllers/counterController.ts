import type { Request, Response } from 'express';
import type { CounterService } from '../services/CounterService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { counterEventsQuerySchema, counterReceiptsQuerySchema, counterEventsSchema, counterReportSchema, counterSettingsSchema } from '../validators/counterValidators.js';
import { parseInput } from '../validators/validate.js';

export function createCounterController(counterService: CounterService) {
  return {
    async settings(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await counterService.settings());
    },

    async updateSettings(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await counterService.updateSettings(parseInput(counterSettingsSchema, req.body), req.user!.id), { message: 'Counter settings saved' });
    },

    async record(req: Request, res: Response): Promise<void> {
      await counterService.record(parseInput(counterEventsSchema, req.body).events, req.user!.id);
      sendSuccess(res, null, { statusCode: 201 });
    },

    async today(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await counterService.today());
    },

    async receipts(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await counterService.receipts(parseInput(counterReceiptsQuerySchema, req.query)));
    },

    async people(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await counterService.people(parseInput(counterReportSchema, req.query)));
    },

    async events(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await counterService.events(parseInput(counterEventsQuerySchema, req.query)));
    },
  };
}
