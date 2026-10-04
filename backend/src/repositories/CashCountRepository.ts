import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';

export type CashPlace = 'shop' | 'carwash';

export interface CashCountRecord {
  id: number;
  place: CashPlace;
  /** "2026-10-04" */
  day: string;
  float_amount: string;
  counted_amount: string;
  note: string | null;
  counted_by_name: string | null;
  counted_at: Date;
}

/** Days are "YYYY-MM-DD" strings both ways, so no time zone ever shifts them. */
export class CashCountRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** Newest first, `from` and `to` both included. */
  async findBetween(from: string, to: string): Promise<CashCountRecord[]> {
    return this.db
      .selectFrom('cash_counts as c')
      .leftJoin('users as u', 'u.id', 'c.counted_by')
      .select([
        'c.id',
        'c.place',
        sql<string>`to_char(c.day, 'YYYY-MM-DD')`.as('day'),
        'c.float_amount',
        'c.counted_amount',
        'c.note',
        'u.name as counted_by_name',
        'c.counted_at',
      ])
      .where('c.day', '>=', from)
      .where('c.day', '<=', to)
      .orderBy('c.day', 'desc')
      .orderBy('c.place', 'desc')
      .execute();
  }

  /** Counting the same place twice on one day replaces the first count. Returns the row's id. */
  async save(entry: { place: CashPlace; day: string; float: number; counted: number; note: string | null; countedBy: number }): Promise<number> {
    const row = await this.db
      .insertInto('cash_counts')
      .values({
        place: entry.place,
        day: entry.day,
        float_amount: entry.float,
        counted_amount: entry.counted,
        note: entry.note,
        counted_by: entry.countedBy,
      })
      .onConflict((conflict) =>
        conflict.columns(['place', 'day']).doUpdateSet({
          float_amount: entry.float,
          counted_amount: entry.counted,
          note: entry.note,
          counted_by: entry.countedBy,
          counted_at: new Date(),
        }),
      )
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /** Carwash takings (carwash + change) for each day that has them. */
  async carwashTakingsByDay(from: string, to: string): Promise<Map<string, number>> {
    const rows = await this.db
      .selectFrom('carwash_days')
      .select([sql<string>`to_char(day, 'YYYY-MM-DD')`.as('day'), sql<string>`carwash_amount + change_amount`.as('total')])
      .where('day', '>=', from)
      .where('day', '<=', to)
      .execute();
    return new Map(rows.map((row) => [row.day, Number(row.total)]));
  }
}
