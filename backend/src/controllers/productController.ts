import type { Request, Response } from 'express';
import type { ActivityLogService } from '../services/ActivityLogService.js';
import type { ProductService } from '../services/ProductService.js';
import { uploadedImage } from './profileController.js';
import { sendSuccess } from '../utils/apiResponse.js';
import {
  barcodeParamsSchema,
  createProductSchema,
  productQuerySchema,
  setBarcodeSchema,
  updateProductSchema,
} from '../validators/catalogValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

export function createProductController(productService: ProductService, activityLogService: ActivityLogService) {
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

    async getByBarcode(req: Request, res: Response): Promise<void> {
      const { barcode } = parseInput(barcodeParamsSchema, req.params);
      sendSuccess(res, await productService.getByBarcode(barcode, req.identity?.role));
    },

    async setBarcode(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { barcode } = parseInput(setBarcodeSchema, req.body);
      sendSuccess(res, await productService.setBarcode(id, barcode, req.user!.id), { message: 'Barcode saved' });
    },

    async setImage(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await productService.setImage(id, uploadedImage(req), req.user!.id), { message: 'Photo saved' });
    },

    async removeImage(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await productService.setImage(id, null, req.user!.id), { message: 'Photo removed' });
    },

    async createBarcode(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await productService.createBarcode(id, req.user!.id), { statusCode: 201, message: 'Barcode created' });
    },

    async priceHistory(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await productService.getById(id, 'admin'); // 404 for a product that doesn't exist
      sendSuccess(res, await activityLogService.priceHistory(id));
    },

    async create(req: Request, res: Response): Promise<void> {
      const input = parseInput(createProductSchema, req.body);
      const product = await productService.create(input, req.user!.id);
      sendSuccess(res, product, { statusCode: 201, message: 'Product created' });
    },

    async update(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const input = parseInput(updateProductSchema, req.body);
      sendSuccess(res, await productService.update(id, input, req.user!.id), { message: 'Product updated' });
    },

    async remove(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await productService.delete(id, req.user!.id);
      sendSuccess(res, null, { message: 'Product deleted' });
    },
  };
}
