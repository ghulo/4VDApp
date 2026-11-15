import type { Request, Response } from 'express';
import type { StockDocumentService } from '../services/StockDocumentService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { reportRangeSchema } from '../validators/reportValidators.js';
import { newStockDocumentSchema } from '../validators/stockDocumentValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

export function createStockDocumentController(service: StockDocumentService) {
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
      const document = await service.create(parseInput(newStockDocumentSchema, req.body), req.user!.id);
      sendSuccess(res, document, { statusCode: 201, message: 'Stock document saved' });
    },

    async void(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.void(id, req.user!.id), { message: 'Stock document voided' });
    },
  };
}
