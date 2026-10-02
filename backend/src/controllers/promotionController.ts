import type { Request, Response } from 'express';
import type { PromotionService } from '../services/PromotionService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { createPromotionSchema } from '../validators/catalogValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

export function createPromotionController(promotionService: PromotionService) {
  return {
    async list(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await promotionService.list());
    },

    async create(req: Request, res: Response): Promise<void> {
      const input = parseInput(createPromotionSchema, req.body);
      const promotion = await promotionService.create(input, req.user!.id);
      sendSuccess(res, promotion, { statusCode: 201, message: 'Promotion created' });
    },

    async end(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await promotionService.endEarly(id, req.user!.id), { message: 'Promotion ended' });
    },
  };
}
