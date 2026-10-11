import type { Request, Response } from 'express';
import type { BillScanService } from '../services/BillScanService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { confirmScanSchema, scanQuerySchema, scanUploadSchema } from '../validators/orderValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

export function createBillScanController(scanService: BillScanService) {
  return {
    async scan(req: Request, res: Response): Promise<void> {
      const { pages } = parseInput(scanUploadSchema, req.body);
      sendSuccess(res, await scanService.scan(pages, req.user!.id), { statusCode: 201, message: 'Bill read' });
    },

    async waiting(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await scanService.waiting());
    },

    async get(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { supplierId } = parseInput(scanQuerySchema, req.query);
      sendSuccess(res, await scanService.get(id, supplierId));
    },

    async confirm(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await scanService.confirm(id, parseInput(confirmScanSchema, req.body), req.user!.id), { message: 'Bill confirmed' });
    },

    async discard(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await scanService.discard(id, req.user!.id);
      sendSuccess(res, null, { message: 'Scan discarded' });
    },
  };
}
