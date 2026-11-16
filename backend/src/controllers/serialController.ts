import type { Request, Response } from 'express';
import { z } from 'zod';
import type { SerialService } from '../services/SerialService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { addSerialsSchema, serialProductSchema, serialSearchSchema } from '../validators/serialValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

const productParamsSchema = z.object({ productId: z.coerce.number().int().positive() });

export function createSerialController(service: SerialService) {
  return {
    async products(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await service.products());
    },
    async setProduct(req: Request, res: Response): Promise<void> {
      const { productId } = parseInput(productParamsSchema, req.params);
      sendSuccess(res, await service.setProduct(productId, parseInput(serialProductSchema, req.body), req.user!.id));
    },
    async forProduct(req: Request, res: Response): Promise<void> {
      const { productId } = parseInput(productParamsSchema, req.params);
      sendSuccess(res, await service.forProduct(productId));
    },
    async search(req: Request, res: Response): Promise<void> {
      const { q } = parseInput(serialSearchSchema, req.query);
      sendSuccess(res, await service.search(q));
    },
    async add(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await service.add(parseInput(addSerialsSchema, req.body), req.user!.id), { statusCode: 201, message: 'Serial numbers recorded' });
    },
    async remove(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await service.remove(id, req.user!.id);
      sendSuccess(res, null, { message: 'Serial number removed' });
    },
  };
}
