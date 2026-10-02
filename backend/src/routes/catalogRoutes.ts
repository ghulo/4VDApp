import { Router } from 'express';
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
  router.post('/', ...guards.admin, controller.create);
  router.put('/:id', ...guards.admin, controller.update);
  router.delete('/:id', ...guards.admin, controller.remove);

  return router;
}

export function createProductRoutes({ productService, activityLogService, guards }: Container): Router {
  const controller = createProductController(productService, activityLogService);
  const router = Router();

  router.get('/', guards.authenticated, controller.list);
  router.get('/:id', guards.authenticated, controller.getById);
  router.get('/:id/price-history', ...guards.admin, controller.priceHistory);
  router.post('/', ...guards.admin, controller.create);
  router.put('/:id', ...guards.admin, controller.update);
  router.delete('/:id', ...guards.admin, controller.remove);

  return router;
}

export function createInventoryRoutes({ inventoryService, guards }: Container): Router {
  const controller = createInventoryController(inventoryService);
  const router = Router();

  router.get('/', guards.authenticated, controller.list);
  router.get('/:productId', guards.authenticated, controller.getByProductId);
  router.patch('/:productId', ...guards.admin, controller.adjust);

  return router;
}

export function createPromotionRoutes({ promotionService, guards }: Container): Router {
  const controller = createPromotionController(promotionService);
  const router = Router();

  router.use(...guards.admin);
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.post('/:id/end', controller.end);

  return router;
}

export function createPricingRoutes({ pricingService, guards }: Container): Router {
  const controller = createPricingController(pricingService);
  const router = Router();

  router.get('/tiers/:productId', guards.authenticated, controller.getTiers);
  router.put('/tiers/:productId', ...guards.admin, controller.replaceTiers);

  return router;
}
