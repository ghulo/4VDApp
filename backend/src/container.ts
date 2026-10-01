import type { RequestHandler } from 'express';
import type { AppConfig } from './config/env.js';
import type { DatabaseClient } from './database/connection.js';
import { requireAuth, requireRole } from './middlewares/authenticate.js';
import { CategoryRepository } from './repositories/CategoryRepository.js';
import { InventoryRepository } from './repositories/InventoryRepository.js';
import { PricingTierRepository } from './repositories/PricingTierRepository.js';
import { ProductRepository } from './repositories/ProductRepository.js';
import { RefreshTokenRepository } from './repositories/RefreshTokenRepository.js';
import { StockAdjustmentRepository } from './repositories/StockAdjustmentRepository.js';
import { TransactionManager } from './repositories/TransactionManager.js';
import { UserRepository } from './repositories/UserRepository.js';
import { AuthService } from './services/AuthService.js';
import { CategoryService } from './services/CategoryService.js';
import { InventoryService } from './services/InventoryService.js';
import { PricingService } from './services/PricingService.js';
import { ProductService } from './services/ProductService.js';

/**
 * The one place where repositories and services are created and wired
 * together (constructor injection, see docs/ARCHITECTURE.md). Tests can build
 * their own container with fakes instead.
 */
export function createContainer(config: AppConfig, db: DatabaseClient) {
  const transactions = new TransactionManager(db);
  const userRepository = new UserRepository(db);
  const refreshTokenRepository = new RefreshTokenRepository(db);
  const categoryRepository = new CategoryRepository(db);
  const productRepository = new ProductRepository(db);
  const pricingTierRepository = new PricingTierRepository(db);
  const inventoryRepository = new InventoryRepository(db);
  const stockAdjustmentRepository = new StockAdjustmentRepository(db);

  const authService = new AuthService(userRepository, refreshTokenRepository, config);
  const categoryService = new CategoryService(categoryRepository);
  const productService = new ProductService(productRepository, categoryRepository, pricingTierRepository, transactions);
  const inventoryService = new InventoryService(inventoryRepository, stockAdjustmentRepository, transactions);
  const pricingService = new PricingService(productRepository, pricingTierRepository, transactions);

  const authenticated = requireAuth(userRepository);
  const guards = {
    authenticated,
    // Arrays so routes can spread them: router.post('/', ...guards.admin, handler)
    admin: [authenticated, requireRole('admin')] as RequestHandler[],
    staff: [authenticated, requireRole('admin', 'employee')] as RequestHandler[],
  };

  return {
    config,
    db,
    userRepository,
    authService,
    categoryService,
    productService,
    inventoryService,
    pricingService,
    guards,
  };
}

export type Container = ReturnType<typeof createContainer>;
