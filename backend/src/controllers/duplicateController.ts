import type { Request, Response } from 'express';
import { z } from 'zod';
import type { DuplicateService } from '../services/DuplicateService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

const listSchema = z.object({ status: z.enum(['open', 'done']).default('open') });
const mergeSchema = z.object({ keepId: z.coerce.number().int().positive() });

export function createDuplicateController(duplicateService: DuplicateService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const { status } = parseInput(listSchema, req.query);
      sendSuccess(res, await duplicateService.list(status));
    },

    async merge(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await duplicateService.merge(id, parseInput(mergeSchema, req.body), req.user!.id);
      sendSuccess(res, null, { message: 'Products merged' });
    },

    async keepBoth(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await duplicateService.keepBoth(id, req.user!.id);
      sendSuccess(res, null, { message: 'Kept as two products' });
    },
  };
}
