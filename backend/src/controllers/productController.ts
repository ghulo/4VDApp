import type { Request, Response } from 'express';
import type { ProductService } from '../services/ProductService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { createProductSchema, productQuerySchema, updateProductSchema } from '../validators/catalogValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

export function createProductController(productService: ProductService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const query = parseInput(productQuerySchema, req.query);
      const { items, meta } = await productService.list(query, req.identity?.role);
      sendSuccess(res, items, { meta });
    },

    async getById(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await productService.getById(id, req.identity?.role));
    },

    async create(req: Request, res: Response): Promise<void> {
      const input = parseInput(createProductSchema, req.body);
      const product = await productService.create(input, req.user!.id);
      sendSuccess(res, product, { statusCode: 201, message: 'Product created' });
    },

    async update(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const input = parseInput(updateProductSchema, req.body);
      sendSuccess(res, await productService.update(id, input), { message: 'Product updated' });
    },

    async remove(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await productService.delete(id);
      sendSuccess(res, null, { message: 'Product deleted' });
    },
  };
}
