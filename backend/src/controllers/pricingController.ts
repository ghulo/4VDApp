import type { Request, Response } from 'express';
import type { PricingService } from '../services/PricingService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { replacePricingTiersSchema } from '../validators/catalogValidators.js';
import { parseInput, productIdParamsSchema } from '../validators/validate.js';

export function createPricingController(pricingService: PricingService) {
  return {
    async getTiers(req: Request, res: Response): Promise<void> {
      const { productId } = parseInput(productIdParamsSchema, req.params);
      sendSuccess(res, await pricingService.getTiers(productId, req.identity?.role === 'admin'));
    },

    async replaceTiers(req: Request, res: Response): Promise<void> {
      const { productId } = parseInput(productIdParamsSchema, req.params);
      const { tiers } = parseInput(replacePricingTiersSchema, req.body);
      sendSuccess(res, await pricingService.replaceTiers(productId, tiers), { message: 'Pricing tiers updated' });
    },
  };
}
