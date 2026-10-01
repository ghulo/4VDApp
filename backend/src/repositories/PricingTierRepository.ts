import type { DatabaseClient } from '../database/connection.js';
import type { PricingTier } from '../services/pricing/bulkPricing.js';

export class PricingTierRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** Tiers for many products in one query (avoids one query per product). */
  async findByProductIds(productIds: number[]): Promise<Map<number, PricingTier[]>> {
    const tiersByProduct = new Map<number, PricingTier[]>();
    if (productIds.length === 0) return tiersByProduct;

    const rows = await this.db
      .selectFrom('bulk_pricing_tiers')
      .select(['product_id', 'quantity_min', 'price'])
      .where('product_id', 'in', productIds)
      .orderBy('quantity_min')
      .execute();

    for (const row of rows) {
      const tiers = tiersByProduct.get(row.product_id) ?? [];
      tiers.push({ quantity: row.quantity_min, price: Number(row.price) });
      tiersByProduct.set(row.product_id, tiers);
    }
    return tiersByProduct;
  }

  async findByProductId(productId: number): Promise<PricingTier[]> {
    return (await this.findByProductIds([productId])).get(productId) ?? [];
  }

  /** Replace all tiers of a product. Call inside a transaction. */
  async replaceForProduct(productId: number, tiers: PricingTier[]): Promise<void> {
    await this.db.deleteFrom('bulk_pricing_tiers').where('product_id', '=', productId).execute();
    if (tiers.length === 0) return;
    await this.db
      .insertInto('bulk_pricing_tiers')
      .values(tiers.map((tier) => ({ product_id: productId, quantity_min: tier.quantity, price: tier.price })))
      .execute();
  }
}
