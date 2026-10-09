import type { Request, Response } from 'express';
import type { CarwashService } from '../services/CarwashService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { canManage } from '../utils/roles.js';
import {
  carwashDayParamsSchema,
  carwashIdQuerySchema,
  carwashListQuerySchema,
  carwashTakingsSchema,
  newCarwashSchema,
  updateCarwashSchema,
} from '../validators/carwashValidators.js';
import { reportRangeSchema } from '../validators/reportValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

export function createCarwashController(carwashService: CarwashService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const { startDate, endDate } = parseInput(reportRangeSchema, req.query);
      const { carwashId } = parseInput(carwashIdQuerySchema, req.query);
      sendSuccess(res, await carwashService.list({ startDate, endDate }, carwashId));
    },

    async save(req: Request, res: Response): Promise<void> {
      const { day } = parseInput(carwashDayParamsSchema, req.params);
      const { carwashId, ...takings } = parseInput(carwashTakingsSchema, req.body);
      await carwashService.save(carwashId, day, takings, req.user!.id, { anyDay: canManage(req.user!.role) });
      sendSuccess(res, null, { message: 'Carwash takings saved' });
    },

    async today(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await carwashService.today());
    },

    async remove(req: Request, res: Response): Promise<void> {
      const { day } = parseInput(carwashDayParamsSchema, req.params);
      const { carwashId } = parseInput(carwashIdQuerySchema, req.query);
      await carwashService.remove(carwashId, day, req.user!.id);
      sendSuccess(res, null, { message: 'Carwash takings removed' });
    },

    /** Staff pick from the open carwashes; managers can also see the archived ones. */
    async carwashes(req: Request, res: Response): Promise<void> {
      const { includeArchived } = parseInput(carwashListQuerySchema, req.query);
      sendSuccess(res, await carwashService.carwashes({ includeArchived: includeArchived && canManage(req.user!.role) }));
    },

    async add(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await carwashService.add(parseInput(newCarwashSchema, req.body), req.user!.id), { statusCode: 201 });
    },

    async update(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await carwashService.update(id, parseInput(updateCarwashSchema, req.body), req.user!.id), { message: 'Carwash saved' });
    },
  };
}
