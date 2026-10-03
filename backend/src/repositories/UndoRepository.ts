import type { DatabaseClient } from '../database/connection.js';

/** Who undid a row, and when; null when it stands. */
export interface UndoState {
  undone_at: Date | null;
  undone_by: number | null;
}

/** Where undo state is kept: the row an entry changed, or the log entry itself. */
export type UndoRow =
  | { table: 'sales' | 'returns' | 'write_offs' | 'activity_log'; id: number }
  | { table: 'stock_count_lines'; countId: number; productId: number };

/**
 * Reads the rows an undo touches, locked so two people undoing the same
 * thing at the same moment can't both pass the "already undone" check.
 * The lock methods must run in a transaction.
 */
export class UndoRepository {
  constructor(private readonly db: DatabaseClient) {}

  findEntry(id: number) {
    return this.db
      .selectFrom('activity_log')
      .select(['id', 'action', 'entity_id', 'details', 'summary', 'user_id', 'undone_at', 'undone_by'])
      .where('id', '=', id)
      .executeTakeFirst();
  }

  lockEntry(id: number) {
    return this.db
      .selectFrom('activity_log')
      .select(['id', 'entity_id', 'details', 'user_id', 'undone_at', 'undone_by'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
  }

  lockSale(id: number) {
    return this.db
      .selectFrom('sales as s')
      .innerJoin('products as p', 'p.id', 's.product_id')
      .select(['s.id', 's.product_id', 'p.name as product_name', 's.quantity_sold', 's.sold_by', 's.undone_at', 's.undone_by'])
      .where('s.id', '=', id)
      .forUpdate('s')
      .executeTakeFirst();
  }

  /** Returns of a sale that still stand: waiting or approved, and not undone. */
  async standingReturns(saleId: number): Promise<number> {
    const row = await this.db
      .selectFrom('returns')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('sale_id', '=', saleId)
      .where('status', 'in', ['pending', 'approved'])
      .where('undone_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  lockReturn(id: number) {
    return this.db
      .selectFrom('returns as r')
      .innerJoin('sales as s', 's.id', 'r.sale_id')
      .innerJoin('products as p', 'p.id', 's.product_id')
      .select([
        'r.id',
        'r.sale_id',
        's.product_id',
        'p.name as product_name',
        'r.quantity',
        'r.condition',
        'r.status',
        'r.requested_by',
        'r.undone_at',
        'r.undone_by',
      ])
      .where('r.id', '=', id)
      .forUpdate('r')
      .executeTakeFirst();
  }

  /** The write-off a damaged return created, if any. */
  async writeOffOfReturn(returnId: number): Promise<number | undefined> {
    const row = await this.db.selectFrom('write_offs').select('id').where('return_id', '=', returnId).executeTakeFirst();
    return row?.id;
  }

  lockWriteOff(id: number) {
    return this.db
      .selectFrom('write_offs as w')
      .innerJoin('products as p', 'p.id', 'w.product_id')
      .select(['w.id', 'w.product_id', 'p.name as product_name', 'w.quantity', 'w.status', 'w.return_id', 'w.requested_by', 'w.undone_at', 'w.undone_by'])
      .where('w.id', '=', id)
      .forUpdate('w')
      .executeTakeFirst();
  }

  lockCountLine(countId: number, productId: number) {
    return this.db
      .selectFrom('stock_count_lines as l')
      .innerJoin('stock_counts as c', 'c.id', 'l.count_id')
      .innerJoin('products as p', 'p.id', 'l.product_id')
      .select(['l.counted_quantity', 'l.expected_quantity', 'l.status', 'c.submitted_by', 'p.name as product_name', 'l.undone_at', 'l.undone_by'])
      .where('l.count_id', '=', countId)
      .where('l.product_id', '=', productId)
      .forUpdate('l')
      .executeTakeFirst();
  }

  /** Mark a row undone (with who and why), or clear it again on restore. */
  async mark(row: UndoRow, undo: { by: number; note: string | null } | null): Promise<void> {
    const values = undo
      ? { undone_at: new Date(), undone_by: undo.by, undo_note: undo.note }
      : { undone_at: null, undone_by: null, undo_note: null };
    if (row.table === 'stock_count_lines') {
      await this.db
        .updateTable('stock_count_lines')
        .set(values)
        .where('count_id', '=', row.countId)
        .where('product_id', '=', row.productId)
        .execute();
    } else {
      await this.db.updateTable(row.table).set(values).where('id', '=', row.id).execute();
    }
  }
}
