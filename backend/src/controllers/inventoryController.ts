import type { Request, Response } from 'express';
import type { InventoryService } from '../services/InventoryService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { inventoryQuerySchema, stockAdjustmentSchema } from '../validators/catalogValidators.js';
import { parseInput, productIdParamsSchema } from '../validators/validate.js';

export function createInventoryController(inventoryService: InventoryService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const query = parseInput(inventoryQuerySchema, req.query);
      const { items, meta } = await inventoryService.list({ ...query, lowStockOnly: query.lowStock });
      sendSuccess(res, items, { meta });
    },

    async getByProductId(req: Request, res: Response): Promise<void> {
      const { productId } = parseInput(productIdParamsSchema, req.params);
      sendSuccess(res, await inventoryService.getByProductId(productId));
    },

    async adjust(req: Request, res: Response): Promise<void> {
      const { productId } = parseInput(productIdParamsSchema, req.params);
      const input = parseInput(stockAdjustmentSchema, req.body);
      const result = await inventoryService.adjust(productId, input, req.user!.id);
      sendSuccess(res, result, { message: 'Stock updated' });
    },
  };
}
