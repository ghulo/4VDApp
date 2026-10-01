import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import type { CategoryRow } from '../database/types.js';

export interface CategoryWithCount extends CategoryRow {
  product_count: number;
}

export class CategoryRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findAll(): Promise<CategoryWithCount[]> {
    const rows = await this.db
      .selectFrom('categories as c')
      .leftJoin('products as p', (join) => join.onRef('p.category_id', '=', 'c.id').on('p.deleted_at', 'is', null))
      .selectAll('c')
      .select((eb) => eb.fn.count<string>('p.id').as('product_count'))
      .where('c.deleted_at', 'is', null)
      .groupBy('c.id')
      .orderBy('c.name')
      .execute();
    return rows.map((row) => ({ ...row, product_count: Number(row.product_count) }));
  }

  findById(id: number): Promise<CategoryRow | undefined> {
    return this.db
      .selectFrom('categories')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  findByName(name: string): Promise<CategoryRow | undefined> {
    return this.db
      .selectFrom('categories')
      .selectAll()
      .where(sql<string>`lower(name)`, '=', name.toLowerCase())
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  create(data: { name: string; description: string | null }): Promise<CategoryRow> {
    return this.db.insertInto('categories').values(data).returningAll().executeTakeFirstOrThrow();
  }

  update(id: number, data: { name: string; description: string | null }): Promise<CategoryRow | undefined> {
    return this.db
      .updateTable('categories')
      .set({ ...data, updated_at: new Date() })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returningAll()
      .executeTakeFirst();
  }

  async countProducts(id: number): Promise<number> {
    const row = await this.db
      .selectFrom('products')
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .where('category_id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(row.total);
  }

  async softDelete(id: number): Promise<boolean> {
    const result = await this.db
      .updateTable('categories')
      .set({ deleted_at: new Date(), updated_at: new Date() })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }
}
