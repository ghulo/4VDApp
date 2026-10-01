import type { DatabaseClient } from '../database/connection.js';
import { InventoryRepository } from './InventoryRepository.js';
import { NotificationRepository } from './NotificationRepository.js';
import { PricingTierRepository } from './PricingTierRepository.js';
import { ProductRepository } from './ProductRepository.js';
import { StockAdjustmentRepository } from './StockAdjustmentRepository.js';

function createTransactionalRepositories(db: DatabaseClient) {
  return {
    products: new ProductRepository(db),
    pricingTiers: new PricingTierRepository(db),
    inventory: new InventoryRepository(db),
    stockAdjustments: new StockAdjustmentRepository(db),
    notifications: new NotificationRepository(db),
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
