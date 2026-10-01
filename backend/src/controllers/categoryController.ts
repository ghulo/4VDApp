import type { Request, Response } from 'express';
import type { CategoryService } from '../services/CategoryService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { categorySchema } from '../validators/catalogValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

export function createCategoryController(categoryService: CategoryService) {
  return {
    async list(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await categoryService.list());
    },

    async create(req: Request, res: Response): Promise<void> {
      const input = parseInput(categorySchema, req.body);
      const category = await categoryService.create(input, req.user!.id);
      sendSuccess(res, category, { statusCode: 201, message: 'Category created' });
    },

    async update(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const input = parseInput(categorySchema, req.body);
      sendSuccess(res, await categoryService.update(id, input, req.user!.id), { message: 'Category updated' });
    },

    async remove(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await categoryService.delete(id, req.user!.id);
      sendSuccess(res, null, { message: 'Category deleted' });
    },
  };
}
