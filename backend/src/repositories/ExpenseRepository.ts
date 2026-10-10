import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import type { ExpenseCategory, ExpensePlace } from '../constants/expenses.js';

export interface ExpenseRecord {
  id: number;
  /** "2026-10-04" */
  day: string;
  amount: string;
  category: ExpenseCategory;
  place: ExpensePlace;
  carwash_id: number | null;
  carwash_name: string | null;
  note: string | null;
  recurring_id: number | null;
  created_by_name: string | null;
}

export interface RecurringExpenseRecord {
  id: number;
  amount: string;
  category: ExpenseCategory;
  place: ExpensePlace;
  carwash_id: number | null;
  carwash_name: string | null;
  note: string | null;
  day_of_month: number;
  /** The last day it added an expense for. */
  last_filled_on: string;
  created_by_name: string | null;
}

export interface NewExpense {
  day: string;
  amount: number;
  category: ExpenseCategory;
  place: ExpensePlace;
  carwashId: number | null;
  note: string | null;
  recurringId: number | null;
  createdBy: number | null;
}

/** Days are "YYYY-MM-DD" strings both ways, so no time zone ever shifts them. */
export class ExpenseRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** Newest first, `from` and `to` both included. */
  async findBetween(from: string, to: string): Promise<ExpenseRecord[]> {
    return this.db
      .selectFrom('expenses as e')
      .leftJoin('users as u', 'u.id', 'e.created_by')
      .leftJoin('carwashes as w', 'w.id', 'e.carwash_id')
      .select([
        'e.id',
        sql<string>`to_char(e.day, 'YYYY-MM-DD')`.as('day'),
        'e.amount',
        'e.category',
        'e.place',
        'e.carwash_id',
        'w.name as carwash_name',
        'e.note',
        'e.recurring_id',
        'u.name as created_by_name',
      ])
      .where('e.day', '>=', from)
      .where('e.day', '<=', to)
      .orderBy('e.day', 'desc')
      .orderBy('e.id', 'desc')
      .execute();
  }

  async findById(id: number): Promise<ExpenseRecord | undefined> {
    return this.db
      .selectFrom('expenses as e')
      .leftJoin('users as u', 'u.id', 'e.created_by')
      .leftJoin('carwashes as w', 'w.id', 'e.carwash_id')
      .select([
        'e.id',
        sql<string>`to_char(e.day, 'YYYY-MM-DD')`.as('day'),
        'e.amount',
        'e.category',
        'e.place',
        'e.carwash_id',
        'w.name as carwash_name',
        'e.note',
        'e.recurring_id',
        'u.name as created_by_name',
      ])
      .where('e.id', '=', id)
      .executeTakeFirst();
  }

  /** Total spent from `from` to `to`, both included. */
  async total(from: string, to: string): Promise<number> {
    const row = await this.db
      .selectFrom('expenses')
      .select(sql<string>`coalesce(sum(amount), 0)`.as('total'))
      .where('day', '>=', from)
      .where('day', '<=', to)
      .executeTakeFirstOrThrow();
    return Number(row.total);
  }

  /** Adds an expense. A repeating rule's copy for a day it already has is skipped; returns null then. */
  async add(expense: NewExpense): Promise<number | null> {
    const row = await this.db
      .insertInto('expenses')
      .values({
        day: expense.day,
        amount: expense.amount,
        category: expense.category,
        place: expense.place,
        carwash_id: expense.carwashId,
        note: expense.note,
        recurring_id: expense.recurringId,
        created_by: expense.createdBy,
      })
      .onConflict((conflict) => conflict.columns(['recurring_id', 'day']).doNothing())
      .returning('id')
      .executeTakeFirst();
    return row?.id ?? null;
  }

  async remove(id: number): Promise<void> {
    await this.db.deleteFrom('expenses').where('id', '=', id).execute();
  }

  async findActiveRecurring(): Promise<RecurringExpenseRecord[]> {
    return this.db
      .selectFrom('recurring_expenses as r')
      .leftJoin('users as u', 'u.id', 'r.created_by')
      .leftJoin('carwashes as w', 'w.id', 'r.carwash_id')
      .select([
        'r.id',
        'r.amount',
        'r.category',
        'r.place',
        'r.carwash_id',
        'w.name as carwash_name',
        'r.note',
        'r.day_of_month',
        sql<string>`to_char(r.last_filled_on, 'YYYY-MM-DD')`.as('last_filled_on'),
        'u.name as created_by_name',
      ])
      .where('r.stopped_at', 'is', null)
      .orderBy('r.day_of_month')
      .orderBy('r.id')
      .execute();
  }

  async findRecurringById(id: number): Promise<{ id: number; category: ExpenseCategory; stopped_at: Date | null } | undefined> {
    return this.db.selectFrom('recurring_expenses').select(['id', 'category', 'stopped_at']).where('id', '=', id).executeTakeFirst();
  }

  async addRecurring(rule: {
    amount: number;
    category: ExpenseCategory;
    place: ExpensePlace;
    carwashId: number | null;
    note: string | null;
    dayOfMonth: number;
    lastFilledOn: string;
    createdBy: number;
  }): Promise<number> {
    const row = await this.db
      .insertInto('recurring_expenses')
      .values({
        amount: rule.amount,
        category: rule.category,
        place: rule.place,
        carwash_id: rule.carwashId,
        note: rule.note,
        day_of_month: rule.dayOfMonth,
        last_filled_on: rule.lastFilledOn,
        created_by: rule.createdBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async markFilled(id: number, day: string): Promise<void> {
    await this.db.updateTable('recurring_expenses').set({ last_filled_on: day }).where('id', '=', id).execute();
  }

  async stopRecurring(id: number, at: Date): Promise<void> {
    await this.db.updateTable('recurring_expenses').set({ stopped_at: at }).where('id', '=', id).execute();
  }

  /** A carwash that closes stops its monthly expenses. Returns how many stopped. */
  async stopRecurringForCarwash(carwashId: number, at: Date): Promise<number> {
    const result = await this.db
      .updateTable('recurring_expenses')
      .set({ stopped_at: at })
      .where('carwash_id', '=', carwashId)
      .where('stopped_at', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
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
