import { Router } from 'express';
import type { Container } from '../container.js';
import { createCategoryController } from '../controllers/categoryController.js';
import { createInventoryController } from '../controllers/inventoryController.js';
import { createPricingController } from '../controllers/pricingController.js';
import { createProductController } from '../controllers/productController.js';

export function createCategoryRoutes({ categoryService, guards }: Container): Router {
  const controller = createCategoryController(categoryService);
  const router = Router();

  router.get('/', controller.list);
  router.post('/', ...guards.admin, controller.create);
  router.put('/:id', ...guards.admin, controller.update);
  router.delete('/:id', ...guards.admin, controller.remove);

  return router;
}

export function createProductRoutes({ productService, guards }: Container): Router {
  const controller = createProductController(productService);
  const router = Router();

  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  router.post('/', ...guards.admin, controller.create);
  router.put('/:id', ...guards.admin, controller.update);
  router.delete('/:id', ...guards.admin, controller.remove);

  return router;
}

export function createInventoryRoutes({ inventoryService, guards }: Container): Router {
  const controller = createInventoryController(inventoryService);
  const router = Router();

  router.get('/', controller.list);
  router.get('/:productId', controller.getByProductId);
  router.patch('/:productId', ...guards.admin, controller.adjust);

  return router;
}

export function createPricingRoutes({ pricingService, guards }: Container): Router {
  const controller = createPricingController(pricingService);
  const router = Router();

  router.get('/tiers/:productId', controller.getTiers);
  router.put('/tiers/:productId', ...guards.admin, controller.replaceTiers);

  return router;
}
