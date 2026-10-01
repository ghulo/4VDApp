import type { Request, Response } from 'express';
import type { ReturnService } from '../services/ReturnService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { approvalListQuerySchema, decisionNoteSchema, returnSchema, saleIdParamsSchema } from '../validators/approvalValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

export function createReturnsController(returnService: ReturnService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await returnService.list(parseInput(approvalListQuerySchema, req.query)));
    },

    async request(req: Request, res: Response): Promise<void> {
      const { saleId } = parseInput(saleIdParamsSchema, req.params);
      const item = await returnService.request(saleId, parseInput(returnSchema, req.body), req.user!);
      const message = item.status === 'pending' ? 'Sent for approval' : 'Returned';
      sendSuccess(res, item, { statusCode: 201, message });
    },

    async approve(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await returnService.approve(id, req.user!), { message: 'Approved' });
    },

    async reject(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { note } = parseInput(decisionNoteSchema, req.body);
      sendSuccess(res, await returnService.reject(id, req.user!, note), { message: 'Rejected' });
    },
  };
}
