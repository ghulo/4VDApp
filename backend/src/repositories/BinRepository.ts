import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import type { ExpenseCategory, ExpensePlace } from '../constants/expenses.js';

/** The note an expense's bill gets when it is removed from the Expenses page (ExpenseService.remove). */
export const REMOVED_EXPENSE_NOTE = 'Removed from the expenses';
const RESTORED_EXPENSE_NOTE = `${REMOVED_EXPENSE_NOTE} (put back)`;

export interface BinRow {
  kind: 'product' | 'supplier' | 'customer' | 'expense';
  id: number;
  name: string;
  detail: string | null;
  removed_at: Date;
}

export interface RemovedExpense {
  id: number;
  bill_id: number;
  day: string;
  amount: string;
  category: ExpenseCategory;
  place: ExpensePlace;
  carwash_id: number | null;
  supplier_id: number | null;
  note: string | null;
}

/** A merge of two duplicates touched this product: the one deleted by it went into the other. */
const mergedAway = (db: DatabaseClient) =>
  db
    .selectFrom('product_duplicate_flags as f')
    .select(sql<number>`1`.as('one'))
    .where('f.resolution', '=', 'merged')
    .where(sql<boolean>`products.id in (f.product_id, f.other_product_id)`);

/** What was removed but is only marked, so it can come back. */
export class BinRepository {
  constructor(private readonly db: DatabaseClient) {}

  async removedSince(since: Date): Promise<BinRow[]> {
    const [products, suppliers, customers, expenses] = await Promise.all([
      this.db
        .selectFrom('products')
        .select(['id', 'name', 'barcode as detail', 'deleted_at as removed_at'])
        .where('deleted_at', '>=', since)
        .where(({ not, exists }) => not(exists(mergedAway(this.db))))
        .execute(),
      this.db.selectFrom('suppliers').select(['id', 'name', 'nui as detail', 'archived_at as removed_at']).where('archived_at', '>=', since).execute(),
      this.db.selectFrom('customers').select(['id', 'name', 'phone as detail', 'archived_at as removed_at']).where('archived_at', '>=', since).execute(),
      this.removedExpenses()
        .select(['l.id', sql<string>`l.category`.as('name'), sql<string>`(l.net + l.vat)::text`.as('detail'), 'b.voided_at as removed_at'])
        .where('b.voided_at', '>=', since)
        .execute(),
    ]);
    const tag = <K extends BinRow['kind']>(kind: K, rows: Array<{ id: number; name: string; detail: string | null; removed_at: Date | null }>) =>
      rows.map((row) => ({ kind, id: row.id, name: row.name, detail: row.detail, removed_at: row.removed_at! }));
    return [...tag('product', products), ...tag('supplier', suppliers), ...tag('customer', customers), ...tag('expense', expenses)].sort(
      (a, b) => b.removed_at.getTime() - a.removed_at.getTime(),
    );
  }

  private removedExpenses() {
    return this.db
      .selectFrom('bill_lines as l')
      .innerJoin('supplier_bills as b', 'b.id', 'l.bill_id')
      .where('l.kind', '=', 'cost')
      // As the Expenses page counts them: transport on an import isn't one, and a credit can't come back as a cost.
      .where('l.spread', '=', false)
      .where('b.kind', '<>', 'credit')
      .where('b.paid_now', '=', true)
      .where('b.void_note', '=', REMOVED_EXPENSE_NOTE);
  }

  findRemovedExpense(id: number): Promise<RemovedExpense | undefined> {
    return this.removedExpenses()
      .select([
        'l.id',
        'l.bill_id',
        sql<string>`to_char(b.issued_on, 'YYYY-MM-DD')`.as('day'),
        sql<string>`(l.net + l.vat)::text`.as('amount'),
        sql<ExpenseCategory>`l.category`.as('category'),
        'b.place',
        'b.carwash_id',
        'b.supplier_id',
        sql<string | null>`coalesce(l.description, b.note)`.as('note'),
      ])
      .where('l.id', '=', id)
      .executeTakeFirst();
  }

  /** Once put back as a new expense, the old one leaves the bin. */
  async markExpenseRestored(billId: number): Promise<void> {
    await this.db.updateTable('supplier_bills').set({ void_note: RESTORED_EXPENSE_NOTE }).where('id', '=', billId).execute();
  }

  findRemoved(kind: 'product' | 'supplier' | 'customer', id: number): Promise<{ name: string } | undefined> {
    if (kind === 'product') {
      return this.db
        .selectFrom('products')
        .select('name')
        .where('id', '=', id)
        .where('deleted_at', 'is not', null)
        .where(({ not, exists }) => not(exists(mergedAway(this.db))))
        .executeTakeFirst();
    }
    const table = kind === 'supplier' ? 'suppliers' : 'customers';
    return this.db.selectFrom(table).select('name').where('id', '=', id).where('archived_at', 'is not', null).executeTakeFirst();
  }

  async restore(kind: 'product' | 'supplier' | 'customer', id: number): Promise<void> {
    if (kind === 'product') {
      await this.db.updateTable('products').set({ deleted_at: null, is_active: true, updated_at: new Date() }).where('id', '=', id).execute();
      return;
    }
    await this.db
      .updateTable(kind === 'supplier' ? 'suppliers' : 'customers')
      .set({ archived_at: null })
      .where('id', '=', id)
      .execute();
  }
}
