import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';

export interface CarwashDayRecord {
  /** "2026-10-04" */
  day: string;
  carwash_amount: string;
  change_amount: string;
  recorded_by_name: string | null;
  updated_at: Date;
}

export interface CarwashTotalsRow {
  carwash: string;
  change: string;
  days: string;
}

/** Days are "YYYY-MM-DD" strings both ways, so no time zone ever shifts them. */
export class CarwashRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** Newest first, `from` and `to` both included. */
  async findBetween(from: string, to: string): Promise<CarwashDayRecord[]> {
    return this.db
      .selectFrom('carwash_days as c')
      .leftJoin('users as u', 'u.id', 'c.recorded_by')
      .select([
        sql<string>`to_char(c.day, 'YYYY-MM-DD')`.as('day'),
        'c.carwash_amount',
        'c.change_amount',
        'u.name as recorded_by_name',
        'c.updated_at',
      ])
      .where('c.day', '>=', from)
      .where('c.day', '<=', to)
      .orderBy('c.day', 'desc')
      .execute();
  }

  async findDay(day: string): Promise<{ carwash_amount: string; change_amount: string } | undefined> {
    return this.db
      .selectFrom('carwash_days')
      .select(['carwash_amount', 'change_amount'])
      .where('day', '=', day)
      .executeTakeFirst();
  }

  async totals(from: string, to: string): Promise<CarwashTotalsRow> {
    return this.db
      .selectFrom('carwash_days')
      .select([
        sql<string>`coalesce(sum(carwash_amount), 0)`.as('carwash'),
        sql<string>`coalesce(sum(change_amount), 0)`.as('change'),
        sql<string>`count(*)`.as('days'),
      ])
      .where('day', '>=', from)
      .where('day', '<=', to)
      .executeTakeFirstOrThrow();
  }

  /** Entering a day again replaces what was there. */
  async save(entry: { day: string; carwash: number; change: number; recordedBy: number }): Promise<void> {
    await this.db
      .insertInto('carwash_days')
      .values({ day: entry.day, carwash_amount: entry.carwash, change_amount: entry.change, recorded_by: entry.recordedBy })
      .onConflict((conflict) =>
        conflict.column('day').doUpdateSet({
          carwash_amount: entry.carwash,
          change_amount: entry.change,
          recorded_by: entry.recordedBy,
          updated_at: new Date(),
        }),
      )
      .execute();
  }

  /** True when there was a day to remove. */
  async remove(day: string): Promise<boolean> {
    const result = await this.db.deleteFrom('carwash_days').where('day', '=', day).executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }
}
