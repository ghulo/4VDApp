import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';

/** One side of a pair, with what helps decide which to keep. */
export interface DuplicateSideRecord {
  id: number;
  name: string;
  barcode: string | null;
  other_barcodes: string[];
  sku: string | null;
  base_price: string;
  cost_price: string | null;
  image_url: string | null;
  category_name: string;
  quantity_on_hand: number;
  units_sold_90d: string;
  units_sold: string;
  last_sold_at: Date | null;
}

export interface DuplicatePairRecord {
  id: number;
  reason: string;
  similarity: string | null;
  created_at: Date;
  resolved_at: Date | null;
  resolution: 'merged' | 'kept_both' | null;
  resolved_by_name: string | null;
  product: DuplicateSideRecord;
  other: DuplicateSideRecord;
}

const side = (alias: string) => sql<DuplicateSideRecord>`(
  select json_build_object(
    'id', p.id, 'name', p.name, 'barcode', p.barcode, 'sku', p.sku,
    'other_barcodes', coalesce((select json_agg(b.barcode order by b.id) from product_barcodes b where b.product_id = p.id), '[]'::json),
    'base_price', p.base_price::text, 'cost_price', p.cost_price::text, 'image_url', p.image_url,
    'category_name', c.name, 'quantity_on_hand', coalesce(i.quantity_on_hand, 0),
    'units_sold_90d', (select coalesce(sum(s.quantity_sold), 0) from sales s
      where s.product_id = p.id and s.undone_at is null and s.sale_date > now() - interval '90 days')::text,
    'units_sold', (select coalesce(sum(s.quantity_sold), 0) from sales s where s.product_id = p.id and s.undone_at is null)::text,
    'last_sold_at', (select max(s.sale_date) from sales s where s.product_id = p.id and s.undone_at is null)
  )
  from products p
  join categories c on c.id = p.category_id
  left join inventory i on i.product_id = p.id
  where p.id = ${sql.ref(alias)}
)`;

/** Tables whose rows simply move to the product that is kept. */
const MOVED = [
  'sales',
  'stock_adjustments',
  'write_offs',
  'expiry_dates',
  'purchase_order_lines',
  'product_requests',
  'supplier_product_codes',
  'promotions',
] as const;

export class DuplicateRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** Open pairs (oldest first, so the list works down in order), or the decided ones (newest first). */
  async list(status: 'open' | 'done'): Promise<DuplicatePairRecord[]> {
    const result = await sql<Omit<DuplicatePairRecord, 'product' | 'other'> & { product: DuplicateSideRecord | null; other: DuplicateSideRecord | null }>`
      select f.id, f.reason, f.similarity::text as similarity, f.created_at, f.resolved_at, f.resolution,
        u.name as resolved_by_name,
        ${side('f.product_id')} as product,
        ${side('f.other_product_id')} as other
      from product_duplicate_flags f
      left join users u on u.id = f.resolved_by
      where ${status === 'open' ? sql`f.resolved_at is null` : sql`f.resolved_at is not null`}
      order by ${status === 'open' ? sql`f.created_at, f.id` : sql`f.resolved_at desc, f.id desc`}
    `.execute(this.db);
    return result.rows.filter((row): row is DuplicatePairRecord => row.product !== null && row.other !== null);
  }

  async countOpen(): Promise<number> {
    const row = await this.db
      .selectFrom('product_duplicate_flags')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('resolved_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  /** The pair, locked for the rest of the transaction. */
  async findForUpdate(id: number) {
    return this.db.selectFrom('product_duplicate_flags').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  }

  /** Both products, locked, if neither has been deleted. */
  async lockProducts(ids: number[]) {
    return this.db
      .selectFrom('products as p')
      .leftJoin('inventory as i', 'i.product_id', 'p.id')
      .select(['p.id', 'p.name', 'p.barcode', 'p.cost_price', 'p.deleted_at', 'i.quantity_on_hand', 'i.reorder_level'])
      .where('p.id', 'in', ids)
      .forUpdate('p')
      .execute();
  }

  /**
   * Fold `dropId` into `keepId`: its sales, stock history, damage, expiry
   * dates, order lines, requests, supplier codes, promotions, favourites and
   * count lines move over, its stock is added to the kept one's, and it is
   * deleted (kept in the database for history, like any deleted product).
   * Every barcode it had stays scannable: the kept product keeps its main one
   * (or takes the other's, when it has none) and gets the rest as others.
   */
  async merge(input: { keepId: number; dropId: number; dropStock: number; reorderLevel: number }): Promise<string[]> {
    const { keepId, dropId } = input;
    for (const table of MOVED) {
      await sql`UPDATE ${sql.table(table)} SET product_id = ${keepId} WHERE product_id = ${dropId}`.execute(this.db);
    }
    await sql`
      INSERT INTO favorites (user_id, product_id, created_at)
      SELECT user_id, ${keepId}, created_at FROM favorites WHERE product_id = ${dropId}
      ON CONFLICT DO NOTHING
    `.execute(this.db);
    await sql`DELETE FROM favorites WHERE product_id = ${dropId}`.execute(this.db);
    // A count that has both keeps the kept product's line; the other stays with the deleted product.
    await sql`
      UPDATE stock_count_lines l SET product_id = ${keepId}
      WHERE l.product_id = ${dropId}
        AND NOT EXISTS (SELECT 1 FROM stock_count_lines k WHERE k.count_id = l.count_id AND k.product_id = ${keepId})
    `.execute(this.db);

    await sql`
      UPDATE inventory SET quantity_on_hand = 0, updated_at = now() WHERE product_id = ${dropId}
    `.execute(this.db);
    await sql`
      UPDATE inventory k SET
        quantity_on_hand = k.quantity_on_hand + ${input.dropStock},
        reorder_level = ${input.reorderLevel},
        last_restocked_at = greatest(k.last_restocked_at, (SELECT d.last_restocked_at FROM inventory d WHERE d.product_id = ${dropId})),
        updated_at = now()
      WHERE k.product_id = ${keepId}
    `.execute(this.db);

    // The deleted product lets go of its main barcode before the kept one takes it.
    const dropped = await sql<{ barcode: string | null }>`
      UPDATE products d SET deleted_at = now(), is_active = false, updated_at = now(), barcode = NULL
      FROM (SELECT barcode FROM products WHERE id = ${dropId}) old
      WHERE d.id = ${dropId}
      RETURNING old.barcode
    `.execute(this.db);
    const dropBarcode = dropped.rows[0]?.barcode ?? null;
    const kept = await sql<{ barcode: string | null }>`
      UPDATE products k SET barcode = coalesce(k.barcode, ${dropBarcode}),
        cost_price = coalesce(k.cost_price, (SELECT d.cost_price FROM products d WHERE d.id = ${dropId})),
        updated_at = now()
      WHERE k.id = ${keepId}
      RETURNING k.barcode
    `.execute(this.db);
    const moved = await this.db.selectFrom('product_barcodes').select('barcode').where('product_id', '=', dropId).orderBy('id').execute();
    await this.db.updateTable('product_barcodes').set({ product_id: keepId }).where('product_id', '=', dropId).execute();
    const added = moved.map((row) => row.barcode);
    if (dropBarcode && dropBarcode !== kept.rows[0]?.barcode) {
      await this.db.insertInto('product_barcodes').values({ product_id: keepId, barcode: dropBarcode }).onConflict((oc) => oc.column('barcode').doNothing()).execute();
      added.unshift(dropBarcode);
    }
    return added;
  }

  async resolve(id: number, resolution: 'merged' | 'kept_both', actorId: number): Promise<void> {
    await this.db
      .updateTable('product_duplicate_flags')
      .set({ resolved_at: new Date(), resolved_by: actorId, resolution })
      .where('id', '=', id)
      .execute();
  }

  /**
   * Other open pairs that named the merged-away product now name the kept one.
   * A pair that would be the kept product with itself, or repeat a pair that
   * already exists, goes.
   */
  async repoint(fromId: number, toId: number): Promise<void> {
    const rows = await this.db
      .selectFrom('product_duplicate_flags')
      .select(['id', 'product_id', 'other_product_id'])
      .where('resolved_at', 'is', null)
      .where((eb) => eb.or([eb('product_id', '=', fromId), eb('other_product_id', '=', fromId)]))
      .execute();
    for (const row of rows) {
      const other = row.product_id === fromId ? row.other_product_id : row.product_id;
      const [low, high] = other < toId ? [other, toId] : [toId, other];
      const clash =
        other === toId ||
        (await this.db
          .selectFrom('product_duplicate_flags')
          .select('id')
          .where('product_id', '=', low)
          .where('other_product_id', '=', high)
          .executeTakeFirst());
      if (clash) await this.db.deleteFrom('product_duplicate_flags').where('id', '=', row.id).execute();
      else await this.db.updateTable('product_duplicate_flags').set({ product_id: low, other_product_id: high }).where('id', '=', row.id).execute();
    }
  }
}
