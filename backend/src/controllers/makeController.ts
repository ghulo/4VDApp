import type { Request, Response } from 'express';
import { z } from 'zod';
import type { MakeService } from '../services/MakeService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { makePlanSchema, newMakeSchema, recipeSchema } from '../validators/makeValidators.js';
import { reportRangeSchema } from '../validators/reportValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

const productParamsSchema = z.object({ productId: z.coerce.number().int().positive() });

export function createMakeController(service: MakeService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const { startDate, endDate } = parseInput(reportRangeSchema, req.query);
      sendSuccess(res, await service.list({ startDate, endDate }));
    },
    async get(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.get(id));
    },
    async plan(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await service.plan(parseInput(makePlanSchema, req.query)));
    },
    async create(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await service.create(parseInput(newMakeSchema, req.body), req.user!.id), { statusCode: 201, message: 'Made' });
    },
    async void(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.void(id, req.user!.id), { message: 'Make voided' });
    },
    async recipe(req: Request, res: Response): Promise<void> {
      const { productId } = parseInput(productParamsSchema, req.params);
      sendSuccess(res, await service.recipe(productId));
    },
    async setRecipe(req: Request, res: Response): Promise<void> {
      const { productId } = parseInput(productParamsSchema, req.params);
      const { parts } = parseInput(recipeSchema, req.body);
      sendSuccess(res, await service.setRecipe(productId, parts, req.user!.id));
    },
  };
}
