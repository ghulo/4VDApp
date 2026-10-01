import type { DatabaseClient } from '../database/connection.js';

export interface StockAdjustmentRecord {
  id: number;
  adjustment_quantity: number;
  reason: string;
  notes: string | null;
  adjustment_date: Date;
  adjusted_by_name: string | null;
}

export class StockAdjustmentRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(entry: {
    productId: number;
    quantity: number;
    reason: string;
    notes: string | null;
    adjustedBy: number | null;
  }): Promise<void> {
    await this.db
      .insertInto('stock_adjustments')
      .values({
        product_id: entry.productId,
        adjustment_quantity: entry.quantity,
        reason: entry.reason,
        notes: entry.notes,
        adjusted_by: entry.adjustedBy,
      })
      .execute();
  }

  findRecentForProduct(productId: number, limit: number): Promise<StockAdjustmentRecord[]> {
    return this.db
      .selectFrom('stock_adjustments as s')
      .leftJoin('users as u', 'u.id', 's.adjusted_by')
      .select(['s.id', 's.adjustment_quantity', 's.reason', 's.notes', 's.adjustment_date', 'u.name as adjusted_by_name'])
      .where('s.product_id', '=', productId)
      .orderBy('s.adjustment_date', 'desc')
      .orderBy('s.id', 'desc')
      .limit(limit)
      .execute();
  }
}
