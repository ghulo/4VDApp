import type { Request, Response } from 'express';
import type { ProductRequestService } from '../services/ProductRequestService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { decisionNoteSchema } from '../validators/approvalValidators.js';
import { approveProductRequestSchema, productRequestSchema } from '../validators/catalogValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

export function createProductRequestController(service: ProductRequestService) {
  return {
    async submit(req: Request, res: Response): Promise<void> {
      const outcome = await service.submit(parseInput(productRequestSchema, req.body), req.user!);
      sendSuccess(res, outcome, { statusCode: 201, message: outcome.kind === 'product' ? 'Product added' : 'Sent for approval' });
    },

    async pending(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await service.pending());
    },

    async get(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.get(id));
    },

    async approve(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.approve(id, parseInput(approveProductRequestSchema, req.body ?? {}), req.user!), { message: 'Product added' });
    },

    async reject(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { note } = parseInput(decisionNoteSchema, req.body ?? {});
      sendSuccess(res, await service.reject(id, note, req.user!), { message: 'Not added' });
    },
  };
}
