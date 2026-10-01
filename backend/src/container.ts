import type { RequestHandler } from 'express';
import type { AppConfig } from './config/env.js';
import type { DatabaseClient } from './database/connection.js';
import { requireAuth, requireRole } from './middlewares/authenticate.js';
import { ActivityLogRepository } from './repositories/ActivityLogRepository.js';
import { CategoryRepository } from './repositories/CategoryRepository.js';
import { ActivityLogService } from './services/ActivityLogService.js';
import { FavoriteRepository } from './repositories/FavoriteRepository.js';
import { NotificationRepository } from './repositories/NotificationRepository.js';
import { SalesRepository } from './repositories/SalesRepository.js';
import { SettingsRepository } from './repositories/SettingsRepository.js';
import { SettingsService } from './services/SettingsService.js';
import { WriteOffRepository } from './repositories/WriteOffRepository.js';
import { WriteOffService } from './services/WriteOffService.js';
import { ReturnRepository } from './repositories/ReturnRepository.js';
import { ReturnService } from './services/ReturnService.js';
import { StockCountRepository } from './repositories/StockCountRepository.js';
import { StockCountService } from './services/StockCountService.js';
import { AnalyticsService } from './services/AnalyticsService.js';
import { FavoriteService } from './services/FavoriteService.js';
import { NotificationService } from './services/NotificationService.js';
import { SalesService } from './services/SalesService.js';
import { UserService } from './services/UserService.js';
import { InventoryRepository } from './repositories/InventoryRepository.js';
import { PricingTierRepository } from './repositories/PricingTierRepository.js';
import { ProductRepository } from './repositories/ProductRepository.js';
import { RefreshTokenRepository } from './repositories/RefreshTokenRepository.js';
import { ReportsRepository } from './repositories/ReportsRepository.js';
import { ReportsService } from './services/ReportsService.js';
import { ExportService } from './services/ExportService.js';
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

  const salesRepository = new SalesRepository(db);
  const notificationRepository = new NotificationRepository(db);
  const favoriteRepository = new FavoriteRepository(db);
  const activityLogRepository = new ActivityLogRepository(db);
  const reportsRepository = new ReportsRepository(db);
  const settingsRepository = new SettingsRepository(db);
  const writeOffRepository = new WriteOffRepository(db);
  const returnRepository = new ReturnRepository(db);
  const stockCountRepository = new StockCountRepository(db);

  const authService = new AuthService(userRepository, refreshTokenRepository, activityLogRepository, config);
  const categoryService = new CategoryService(categoryRepository, transactions);
  const productService = new ProductService(productRepository, categoryRepository, pricingTierRepository, transactions);
  const inventoryService = new InventoryService(inventoryRepository, stockAdjustmentRepository, transactions);
  const pricingService = new PricingService(productRepository, pricingTierRepository, transactions);
  const salesService = new SalesService(salesRepository, transactions);
  const analyticsService = new AnalyticsService(
    salesRepository,
    inventoryRepository,
    productRepository,
    stockAdjustmentRepository,
  );
  const userService = new UserService(userRepository, refreshTokenRepository, transactions);
  const notificationService = new NotificationService(notificationRepository);
  const favoriteService = new FavoriteService(favoriteRepository, productRepository, productService);
  const activityLogService = new ActivityLogService(activityLogRepository);
  const reportsService = new ReportsService(reportsRepository);
  const exportService = new ExportService(reportsRepository, reportsService);
  const settingsService = new SettingsService(settingsRepository, transactions);
  const writeOffService = new WriteOffService(writeOffRepository, transactions);
  const returnService = new ReturnService(returnRepository, settingsService, transactions);
  const stockCountService = new StockCountService(stockCountRepository, transactions);

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
    salesService,
    analyticsService,
    userService,
    notificationService,
    favoriteService,
    activityLogRepository,
    activityLogService,
    reportsRepository,
    reportsService,
    exportService,
    settingsService,
    writeOffService,
    returnService,
    stockCountService,
    guards,
  };
}

export type Container = ReturnType<typeof createContainer>;
