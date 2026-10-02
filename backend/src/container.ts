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
import { ApprovalRepository } from './repositories/ApprovalRepository.js';
import { ApprovalService } from './services/ApprovalService.js';
import { AnalyticsService } from './services/AnalyticsService.js';
import { FavoriteService } from './services/FavoriteService.js';
import { NotificationService } from './services/NotificationService.js';
import { SalesService } from './services/SalesService.js';
import { UserService } from './services/UserService.js';
import { InventoryRepository } from './repositories/InventoryRepository.js';
import { PricingTierRepository } from './repositories/PricingTierRepository.js';
import { ProductRepository } from './repositories/ProductRepository.js';
import { PromotionRepository } from './repositories/PromotionRepository.js';
import { PromotionService } from './services/PromotionService.js';
import { PushRepository } from './repositories/PushRepository.js';
import { InsightsRepository } from './repositories/InsightsRepository.js';
import { InsightsService } from './services/InsightsService.js';
import { AssistantService } from './services/AssistantService.js';
import { PriceSuggestionService } from './services/PriceSuggestionService.js';
import { type AiProvider, GeminiProvider } from './services/ai/aiProvider.js';
import { ClaudeProvider } from './services/ai/claudeProvider.js';
import { EmailOutboxRepository } from './repositories/EmailOutboxRepository.js';
import { InviteRepository } from './repositories/InviteRepository.js';
import { InviteService } from './services/InviteService.js';
import { AccountTokenRepository } from './repositories/AccountTokenRepository.js';
import { AccountService } from './services/AccountService.js';
import { EmailService } from './services/email/EmailService.js';
import { type EmailSender, LogSender, ResendSender } from './services/email/senders.js';
import { DailySummaryService } from './services/DailySummaryService.js';
import { type PushSenders, PushService } from './services/PushService.js';
import { ExpoPushSender, WebPushSender } from './services/push/senders.js';
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
export interface ContainerOptions {
  /** Tests pass fakes so nothing is sent to Expo or browsers. */
  pushSenders?: PushSenders;
  /** Tests pass a fake so no email leaves the machine. */
  emailSender?: EmailSender;
  /** Tests pass a fake so nothing is sent to an AI service. Null switches the AI helpers off. */
  aiProvider?: AiProvider | null;
}

export function createContainer(config: AppConfig, db: DatabaseClient, options: ContainerOptions = {}) {
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
  const promotionRepository = new PromotionRepository(db);

  const authService = new AuthService(userRepository, refreshTokenRepository, activityLogRepository, config);
  const categoryService = new CategoryService(categoryRepository, transactions);
  const productService = new ProductService(
    productRepository,
    categoryRepository,
    pricingTierRepository,
    promotionRepository,
    transactions,
  );
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
  const reportsService = new ReportsService(reportsRepository, config.shopTimeZone);
  const exportService = new ExportService(reportsRepository, reportsService);
  const settingsService = new SettingsService(settingsRepository, transactions);
  const writeOffService = new WriteOffService(writeOffRepository, transactions);
  const returnService = new ReturnService(returnRepository, settingsService, transactions);
  const stockCountService = new StockCountService(stockCountRepository, transactions);
  const approvalService = new ApprovalService(new ApprovalRepository(db));
  const promotionService = new PromotionService(promotionRepository, settingsService, transactions);
  const insightsService = new InsightsService(new InsightsRepository(db), reportsRepository, reportsService);
  const dailySummaryService = new DailySummaryService(
    reportsRepository,
    insightsService,
    settingsService,
    settingsRepository,
    notificationRepository,
    config.shopTimeZone,
  );
  const aiProvider =
    options.aiProvider !== undefined
      ? options.aiProvider
      : config.ai?.provider === 'anthropic'
        ? new ClaudeProvider(config.ai.apiKey, config.ai.model, { workspaceId: config.ai.workspaceId })
        : config.ai?.provider === 'gemini'
          ? new GeminiProvider(config.ai.apiKey, config.ai.model)
          : null;
  const assistantService = new AssistantService(
    aiProvider,
    reportsRepository,
    reportsService,
    insightsService,
    promotionService,
    config.shopTimeZone,
  );
  const priceSuggestionService = new PriceSuggestionService(
    aiProvider,
    productService,
    reportsRepository,
    reportsService,
    activityLogService,
    promotionService,
    settingsService,
  );
  const emailService = new EmailService(
    new EmailOutboxRepository(db),
    options.emailSender ??
      (config.email.resendApiKey ? new ResendSender(config.email.resendApiKey, config.email.from) : new LogSender()),
  );
  const inviteService = new InviteService(
    new InviteRepository(db),
    userRepository,
    authService,
    emailService,
    transactions,
    config.dashboardUrl,
  );
  const accountService = new AccountService(
    userRepository,
    new AccountTokenRepository(db),
    refreshTokenRepository,
    emailService,
    config.dashboardUrl,
  );
  const pushService = new PushService(
    new PushRepository(db),
    options.pushSenders ?? {
      expo: new ExpoPushSender(),
      web: config.webPush ? new WebPushSender(config.webPush) : null,
    },
    config.webPush?.publicKey ?? null,
  );

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
    approvalService,
    promotionService,
    pushService,
    insightsService,
    dailySummaryService,
    assistantService,
    priceSuggestionService,
    emailService,
    inviteService,
    accountService,
    guards,
  };
}

export type Container = ReturnType<typeof createContainer>;
