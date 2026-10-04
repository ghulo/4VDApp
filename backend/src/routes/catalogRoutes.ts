import { Router } from 'express';
import { readImage } from './profileRoutes.js';
import type { Container } from '../container.js';
import { createCategoryController } from '../controllers/categoryController.js';
import { createInventoryController } from '../controllers/inventoryController.js';
import { createPricingController } from '../controllers/pricingController.js';
import { createProductController } from '../controllers/productController.js';
import { createPromotionController } from '../controllers/promotionController.js';

export function createCategoryRoutes({ categoryService, guards }: Container): Router {
  const controller = createCategoryController(categoryService);
  const router = Router();

  router.get('/', guards.authenticated, controller.list);
  router.post('/', ...guards.manage, controller.create);
  router.put('/:id', ...guards.manage, controller.update);
  router.delete('/:id', ...guards.manage, controller.remove);

  return router;
}

export function createProductRoutes({ productService, activityLogService, guards }: Container): Router {
  const controller = createProductController(productService, activityLogService);
  const router = Router();

  router.get('/', guards.authenticated, controller.list);
  router.get('/barcode/:barcode', guards.authenticated, controller.getByBarcode);
  router.get('/:id', guards.authenticated, controller.getById);
  router.put('/:id/barcode', ...guards.manage, controller.setBarcode);
  router.post('/:id/barcode', ...guards.manage, controller.createBarcode);
  router.put('/:id/image', ...guards.manage, readImage, controller.setImage);
  router.delete('/:id/image', ...guards.manage, controller.removeImage);
  router.get('/:id/price-history', ...guards.oversee, controller.priceHistory);
  router.post('/', ...guards.manage, controller.create);
  router.put('/:id', ...guards.manage, controller.update);
  router.delete('/:id', ...guards.manage, controller.remove);

  return router;
}

export function createInventoryRoutes({ inventoryService, guards }: Container): Router {
  const controller = createInventoryController(inventoryService);
  const router = Router();

  router.get('/', guards.authenticated, controller.list);
  router.get('/:productId', guards.authenticated, controller.getByProductId);
  router.patch('/:productId', ...guards.manage, controller.adjust);

  return router;
}

export function createPromotionRoutes({ promotionService, guards }: Container): Router {
  const controller = createPromotionController(promotionService);
  const router = Router();

  router.get('/', ...guards.oversee, controller.list);
  router.post('/', ...guards.manage, controller.create);
  router.post('/:id/end', ...guards.manage, controller.end);

  return router;
}

export function createPricingRoutes({ pricingService, guards }: Container): Router {
  const controller = createPricingController(pricingService);
  const router = Router();

  router.get('/tiers/:productId', guards.authenticated, controller.getTiers);
  router.put('/tiers/:productId', ...guards.manage, controller.replaceTiers);

  return router;
}
