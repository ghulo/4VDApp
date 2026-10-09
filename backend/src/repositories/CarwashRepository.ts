import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';

export interface CarwashRecord {
  id: number;
  name: string;
  cash_float: string;
  archived_at: Date | null;
}

export interface CarwashDayRecord {
  carwash_id: number;
  carwash_name: string;
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

  /** Every carwash, the open ones first. */
  async findAll(): Promise<CarwashRecord[]> {
    return this.db
      .selectFrom('carwashes')
      .select(['id', 'name', 'cash_float', 'archived_at'])
      .orderBy(sql`archived_at is not null`)
      .orderBy('id')
      .execute();
  }

  async findById(id: number): Promise<CarwashRecord | undefined> {
    return this.db.selectFrom('carwashes').select(['id', 'name', 'cash_float', 'archived_at']).where('id', '=', id).executeTakeFirst();
  }

  /** True when an open carwash (other than `exceptId`) already has this name, ignoring capitals. */
  async openNameTaken(name: string, exceptId?: number): Promise<boolean> {
    let query = this.db
      .selectFrom('carwashes')
      .select('id')
      .where(sql<boolean>`lower(name) = lower(${name})`)
      .where('archived_at', 'is', null);
    if (exceptId !== undefined) query = query.where('id', '!=', exceptId);
    return (await query.executeTakeFirst()) !== undefined;
  }

  async addCarwash(carwash: { name: string; cashFloat: number }): Promise<number> {
    const row = await this.db
      .insertInto('carwashes')
      .values({ name: carwash.name, cash_float: carwash.cashFloat })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async updateCarwash(id: number, changes: { name?: string; cashFloat?: number; archivedAt?: Date | null }): Promise<void> {
    await this.db
      .updateTable('carwashes')
      .set({
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.cashFloat !== undefined && { cash_float: changes.cashFloat }),
        ...(changes.archivedAt !== undefined && { archived_at: changes.archivedAt }),
      })
      .where('id', '=', id)
      .execute();
  }

  /** Newest first, `from` and `to` both included; one carwash or all of them. */
  async findBetween(from: string, to: string, carwashId?: number): Promise<CarwashDayRecord[]> {
    let query = this.db
      .selectFrom('carwash_days as c')
      .innerJoin('carwashes as w', 'w.id', 'c.carwash_id')
      .leftJoin('users as u', 'u.id', 'c.recorded_by')
      .select([
        'c.carwash_id',
        'w.name as carwash_name',
        sql<string>`to_char(c.day, 'YYYY-MM-DD')`.as('day'),
        'c.carwash_amount',
        'c.change_amount',
        'u.name as recorded_by_name',
        'c.updated_at',
      ])
      .where('c.day', '>=', from)
      .where('c.day', '<=', to);
    if (carwashId !== undefined) query = query.where('c.carwash_id', '=', carwashId);
    return query.orderBy('c.day', 'desc').orderBy('w.id').execute();
  }

  async findDay(carwashId: number, day: string): Promise<{ carwash_amount: string; change_amount: string } | undefined> {
    return this.db
      .selectFrom('carwash_days')
      .select(['carwash_amount', 'change_amount'])
      .where('carwash_id', '=', carwashId)
      .where('day', '=', day)
      .executeTakeFirst();
  }

  /** Which carwashes have takings entered for `day`. */
  async carwashIdsWithDay(day: string): Promise<number[]> {
    const rows = await this.db.selectFrom('carwash_days').select('carwash_id').where('day', '=', day).execute();
    return rows.map((row) => row.carwash_id);
  }

  /** Takings added up for each carwash that has any in the period. */
  async totalsByCarwash(from: string, to: string): Promise<Array<CarwashTotalsRow & { carwash_id: number; name: string }>> {
    return this.db
      .selectFrom('carwash_days as c')
      .innerJoin('carwashes as w', 'w.id', 'c.carwash_id')
      .select([
        'c.carwash_id',
        'w.name',
        sql<string>`coalesce(sum(c.carwash_amount), 0)`.as('carwash'),
        sql<string>`coalesce(sum(c.change_amount), 0)`.as('change'),
        sql<string>`count(*)`.as('days'),
      ])
      .where('c.day', '>=', from)
      .where('c.day', '<=', to)
      .groupBy(['c.carwash_id', 'w.name', 'w.id'])
      .orderBy('w.id')
      .execute();
  }

  /** Entering a day again replaces what was there. */
  async save(entry: { carwashId: number; day: string; carwash: number; change: number; recordedBy: number }): Promise<void> {
    await this.db
      .insertInto('carwash_days')
      .values({
        carwash_id: entry.carwashId,
        day: entry.day,
        carwash_amount: entry.carwash,
        change_amount: entry.change,
        recorded_by: entry.recordedBy,
      })
      .onConflict((conflict) =>
        conflict.columns(['carwash_id', 'day']).doUpdateSet({
          carwash_amount: entry.carwash,
          change_amount: entry.change,
          recorded_by: entry.recordedBy,
          updated_at: new Date(),
        }),
      )
      .execute();
  }

  /** True when there was a day to remove. */
  async remove(carwashId: number, day: string): Promise<boolean> {
    const result = await this.db.deleteFrom('carwash_days').where('carwash_id', '=', carwashId).where('day', '=', day).executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }
}
