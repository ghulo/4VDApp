import type { Request, Response } from 'express';
import type { StockCountService } from '../services/StockCountService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import {
  countLineParamsSchema,
  countLineSchema,
  decisionNoteSchema,
  startCountSchema,
} from '../validators/approvalValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

export function createStockCountsController(stockCountService: StockCountService) {
  return {
    async list(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await stockCountService.list());
    },

    async start(req: Request, res: Response): Promise<void> {
      const { categoryId } = parseInput(startCountSchema, req.body ?? {});
      sendSuccess(res, await stockCountService.start(categoryId, req.user!), { statusCode: 201, message: 'Count started' });
    },

    async get(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await stockCountService.get(id, req.user!));
    },

    async countLine(req: Request, res: Response): Promise<void> {
      const { id, productId } = parseInput(countLineParamsSchema, req.params);
      const { countedQuantity } = parseInput(countLineSchema, req.body);
      sendSuccess(res, await stockCountService.countLine(id, productId, countedQuantity, req.user!), { message: 'Saved' });
    },

    async submit(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await stockCountService.submit(id, req.user!), { message: 'Count submitted' });
    },

    async cancel(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await stockCountService.cancel(id, req.user!), { message: 'Count cancelled' });
    },

    async approveLine(req: Request, res: Response): Promise<void> {
      const { id, productId } = parseInput(countLineParamsSchema, req.params);
      sendSuccess(res, await stockCountService.approveLine(id, productId, req.user!), { message: 'Approved' });
    },

    async rejectLine(req: Request, res: Response): Promise<void> {
      const { id, productId } = parseInput(countLineParamsSchema, req.params);
      const { note } = parseInput(decisionNoteSchema, req.body);
      sendSuccess(res, await stockCountService.rejectLine(id, productId, req.user!, note), { message: 'Rejected' });
    },

    async approveAll(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await stockCountService.approveAll(id, req.user!));
    },
  };
}
