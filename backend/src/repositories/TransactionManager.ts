import type { DatabaseClient } from '../database/connection.js';
import { ActivityLogRepository } from './ActivityLogRepository.js';
import { CarwashRepository } from './CarwashRepository.js';
import { CashCountRepository } from './CashCountRepository.js';
import { ExpenseRepository } from './ExpenseRepository.js';
import { TabRepository } from './TabRepository.js';
import { CategoryRepository } from './CategoryRepository.js';
import { InventoryRepository } from './InventoryRepository.js';
import { NotificationRepository } from './NotificationRepository.js';
import { PricingTierRepository } from './PricingTierRepository.js';
import { ProductRepository } from './ProductRepository.js';
import { PromotionRepository } from './PromotionRepository.js';
import { InviteRepository } from './InviteRepository.js';
import { SalesRepository } from './SalesRepository.js';
import { ReturnRepository } from './ReturnRepository.js';
import { SettingsRepository } from './SettingsRepository.js';
import { StockCountRepository } from './StockCountRepository.js';
import { WriteOffRepository } from './WriteOffRepository.js';
import { StockAdjustmentRepository } from './StockAdjustmentRepository.js';
import { UndoRepository } from './UndoRepository.js';
import { UserRepository } from './UserRepository.js';

function createTransactionalRepositories(db: DatabaseClient) {
  return {
    products: new ProductRepository(db),
    pricingTiers: new PricingTierRepository(db),
    inventory: new InventoryRepository(db),
    stockAdjustments: new StockAdjustmentRepository(db),
    notifications: new NotificationRepository(db),
    sales: new SalesRepository(db),
    activityLog: new ActivityLogRepository(db),
    categories: new CategoryRepository(db),
    users: new UserRepository(db),
    settings: new SettingsRepository(db),
    writeOffs: new WriteOffRepository(db),
    returns: new ReturnRepository(db),
    stockCounts: new StockCountRepository(db),
    promotions: new PromotionRepository(db),
    invites: new InviteRepository(db),
    undo: new UndoRepository(db),
    carwash: new CarwashRepository(db),
    cashCounts: new CashCountRepository(db),
    expenses: new ExpenseRepository(db),
    tabs: new TabRepository(db),
  };
}

export type TransactionalRepositories = ReturnType<typeof createTransactionalRepositories>;

/**
 * Lets services run several repository calls as one all-or-nothing unit
 * without knowing anything about the database. If the callback throws,
 * every change inside it is rolled back.
 */
export class TransactionManager {
  constructor(private readonly db: DatabaseClient) {}

  run<TResult>(work: (repositories: TransactionalRepositories) => Promise<TResult>): Promise<TResult> {
    return this.db.transaction().execute((trx) => work(createTransactionalRepositories(trx)));
  }
}
