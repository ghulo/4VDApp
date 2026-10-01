import type { DatabaseClient } from '../database/connection.js';

export class FavoriteRepository {
  constructor(private readonly db: DatabaseClient) {}

  async listProductIds(userId: number): Promise<number[]> {
    const rows = await this.db
      .selectFrom('favorites as f')
      .innerJoin('products as p', 'p.id', 'f.product_id')
      .select('f.product_id')
      .where('f.user_id', '=', userId)
      .where('p.deleted_at', 'is', null)
      .where('p.is_active', '=', true)
      .orderBy('f.created_at', 'desc')
      .execute();
    return rows.map((row) => row.product_id);
  }

  /** Adding twice is harmless: the second insert is ignored. */
  async add(userId: number, productId: number): Promise<void> {
    await this.db
      .insertInto('favorites')
      .values({ user_id: userId, product_id: productId })
      .onConflict((conflict) => conflict.columns(['user_id', 'product_id']).doNothing())
      .execute();
  }

  async remove(userId: number, productId: number): Promise<void> {
    await this.db.deleteFrom('favorites').where('user_id', '=', userId).where('product_id', '=', productId).execute();
  }
}
