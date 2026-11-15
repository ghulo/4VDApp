import type { Request, Response } from 'express';
import type { PriceService } from '../services/PriceService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { applyPricesSchema, fromCostSchema, priceChangesSchema, priceFileSchema } from '../validators/priceValidators.js';
import { parseInput } from '../validators/validate.js';

/** The Prices page: see every price, plan changes (typed, from cost or from a file), then save them. */
export function createPriceController(priceService: PriceService) {
  return {
    async list(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await priceService.list());
    },

    async plan(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await priceService.plan(parseInput(priceChangesSchema, req.body).changes));
    },

    async fromCost(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await priceService.fromCost(parseInput(fromCostSchema, req.body)));
    },

    async readFile(req: Request, res: Response): Promise<void> {
      const { fileName, data } = parseInput(priceFileSchema, req.body);
      sendSuccess(res, await priceService.readFile(fileName, data));
    },

    async apply(req: Request, res: Response): Promise<void> {
      const { changes, source } = parseInput(applyPricesSchema, req.body);
      sendSuccess(res, await priceService.apply(changes, source, req.user!.id), { message: 'Prices saved' });
    },
  };
}
