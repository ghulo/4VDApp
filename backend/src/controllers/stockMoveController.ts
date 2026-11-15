import type { Request, Response } from 'express';
import type { LocationService } from '../services/LocationService.js';
import type { StockMoveService } from '../services/StockMoveService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { reportRangeSchema } from '../validators/reportValidators.js';
import { newLocationSchema, newStockMoveSchema, shelfMinimumSchema, updateLocationSchema } from '../validators/stockDocumentValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';
import { z } from 'zod';

const productParamsSchema = z.object({ productId: z.coerce.number().int().positive() });

export function createStockMoveController(service: StockMoveService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const { startDate, endDate } = parseInput(reportRangeSchema, req.query);
      sendSuccess(res, await service.list({ startDate, endDate }));
    },
    async get(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.get(id));
    },
    async create(req: Request, res: Response): Promise<void> {
      const move = await service.create(parseInput(newStockMoveSchema, req.body), req.user!.id);
      sendSuccess(res, move, { statusCode: 201, message: 'Stock moved' });
    },
    async void(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.void(id, req.user!.id), { message: 'Move voided' });
    },
  };
}

export function createLocationController(service: LocationService) {
  return {
    async list(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await service.list());
    },
    async create(req: Request, res: Response): Promise<void> {
      const { name } = parseInput(newLocationSchema, req.body);
      sendSuccess(res, await service.create(name, req.user!.id), { statusCode: 201, message: 'Location added' });
    },
    async update(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.update(id, parseInput(updateLocationSchema, req.body), req.user!.id));
    },
    async remove(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await service.remove(id, req.user!.id);
      sendSuccess(res, null, { message: 'Location removed' });
    },
    async forProduct(req: Request, res: Response): Promise<void> {
      const { productId } = parseInput(productParamsSchema, req.params);
      sendSuccess(res, await service.forProduct(productId));
    },
    async setShelfMinimum(req: Request, res: Response): Promise<void> {
      const { productId } = parseInput(productParamsSchema, req.params);
      const { locationId, minimum } = parseInput(shelfMinimumSchema, req.body);
      sendSuccess(res, await service.setShelfMinimum(productId, locationId, minimum));
    },
  };
}
