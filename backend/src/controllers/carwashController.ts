import type { Request, Response } from 'express';
import type { CarwashService } from '../services/CarwashService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { carwashDayParamsSchema, carwashTakingsSchema } from '../validators/carwashValidators.js';
import { reportRangeSchema } from '../validators/reportValidators.js';
import { parseInput } from '../validators/validate.js';

export function createCarwashController(carwashService: CarwashService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const { startDate, endDate } = parseInput(reportRangeSchema, req.query);
      sendSuccess(res, await carwashService.list({ startDate, endDate }));
    },

    async save(req: Request, res: Response): Promise<void> {
      const { day } = parseInput(carwashDayParamsSchema, req.params);
      await carwashService.save(day, parseInput(carwashTakingsSchema, req.body), req.user!.id);
      sendSuccess(res, null, { message: 'Carwash takings saved' });
    },

    async remove(req: Request, res: Response): Promise<void> {
      const { day } = parseInput(carwashDayParamsSchema, req.params);
      await carwashService.remove(day, req.user!.id);
      sendSuccess(res, null, { message: 'Carwash takings removed' });
    },
  };
}
