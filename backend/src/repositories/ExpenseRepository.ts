import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import type { ExpenseCategory, ExpensePlace } from '../constants/expenses.js';

/**
 * One cost on a bill, as the Expenses page shows it. An expense paid on the
 * spot is a bill with one cost line; a rent or power bill to pay later shows
 * here too, so profit counts every cost. A return or credit counts against it.
 */
export interface ExpenseRecord {
  /** The bill line's id (an expense from before bills had lines kept its id). */
  id: number;
  bill_id: number;
  /** "2026-10-04" */
  day: string;
  /** With VAT, as it was paid; negative for a return or credit. */
  amount: string;
  category: ExpenseCategory;
  place: ExpensePlace;
  carwash_id: number | null;
  carwash_name: string | null;
  note: string | null;
  recurring_id: number | null;
  created_by_name: string | null;
  supplier_name: string | null;
  /** Paid when it was entered, so the Expenses page can remove it. */
  paid_now: boolean;
}

/**
 * Costs are read from bills. Days are "YYYY-MM-DD" strings both ways, so no
 * time zone ever shifts them.
 */
export class ExpenseRepository {
  constructor(private readonly db: DatabaseClient) {}

  private costLines() {
    return this.db
      .selectFrom('bill_lines as l')
      .innerJoin('supplier_bills as b', 'b.id', 'l.bill_id')
      .leftJoin('users as u', 'u.id', 'b.created_by')
      .leftJoin('carwashes as w', 'w.id', 'b.carwash_id')
      .leftJoin('suppliers as s', 's.id', 'b.supplier_id')
      .where('l.kind', '=', 'cost')
      // Transport on an import is part of the goods' cost, not a cost of its own.
      .where('l.spread', '=', false)
      .where('b.voided_at', 'is', null);
  }

  private static readonly AMOUNT = sql<string>`(case when b.kind = 'credit' then -1 else 1 end) * (l.net + l.vat)`;

  private records() {
    return this.costLines().select([
      'l.id',
      'l.bill_id',
      sql<string>`to_char(b.issued_on, 'YYYY-MM-DD')`.as('day'),
      ExpenseRepository.AMOUNT.as('amount'),
      sql<ExpenseCategory>`l.category`.as('category'),
      'b.place',
      'b.carwash_id',
      'w.name as carwash_name',
      sql<string | null>`coalesce(l.description, b.note)`.as('note'),
      'b.repeat_id as recurring_id',
      'u.name as created_by_name',
      's.name as supplier_name',
      'b.paid_now',
    ]);
  }

  /** Newest first, `from` and `to` both included. */
  async findBetween(from: string, to: string): Promise<ExpenseRecord[]> {
    return this.records()
      .where('b.issued_on', '>=', from)
      .where('b.issued_on', '<=', to)
      .orderBy('b.issued_on', 'desc')
      .orderBy('l.id', 'desc')
      .execute();
  }

  async findById(id: number): Promise<ExpenseRecord | undefined> {
    return this.records().where('l.id', '=', id).executeTakeFirst();
  }

  /** The cost line of a bill just made from the Expenses page. */
  async findByBill(billId: number): Promise<ExpenseRecord | undefined> {
    return this.records().where('l.bill_id', '=', billId).orderBy('l.position').executeTakeFirst();
  }

  /** Total spent from `from` to `to`, both included. */
  async total(from: string, to: string): Promise<number> {
    const row = await this.costLines()
      .select(sql<string>`coalesce(sum(${ExpenseRepository.AMOUNT}), 0)`.as('total'))
      .where('b.issued_on', '>=', from)
      .where('b.issued_on', '<=', to)
      .executeTakeFirstOrThrow();
    return Number(row.total);
  }

  /** Who said `day` had no expenses, if anyone did. */
  async findNoExpenseMark(day: string): Promise<{ marked_by_name: string | null } | undefined> {
    return this.db
      .selectFrom('no_expense_days as n')
      .leftJoin('users as u', 'u.id', 'n.marked_by')
      .select(['u.name as marked_by_name'])
      .where('n.day', '=', day)
      .executeTakeFirst();
  }

  async markNoExpenses(day: string, userId: number): Promise<void> {
    await this.db
      .insertInto('no_expense_days')
      .values({ day, marked_by: userId })
      .onConflict((conflict) => conflict.column('day').doUpdateSet({ marked_by: userId }))
      .execute();
  }

  async unmarkNoExpenses(day: string): Promise<void> {
    await this.db.deleteFrom('no_expense_days').where('day', '=', day).execute();
  }
}
