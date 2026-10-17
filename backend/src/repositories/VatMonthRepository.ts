import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';

export interface VatMonthRecord {
  month: string;
  filed_at: Date | null;
  filed_by: number | null;
  filed_by_name: string | null;
  figures: unknown;
  refund: string;
  carried_in: string | null;
}

/** VAT months: which are filed (and so locked), what was filed, and the figures typed by hand. */
export class VatMonthRepository {
  constructor(private readonly db: DatabaseClient) {}

  private select() {
    return this.db
      .selectFrom('vat_months as v')
      .leftJoin('users as u', 'u.id', 'v.filed_by')
      .select([sql<string>`to_char(v.month, 'YYYY-MM-DD')`.as('month'), 'v.filed_at', 'v.filed_by', 'u.name as filed_by_name', 'v.figures', 'v.refund', 'v.carried_in']);
  }

  find(month: string): Promise<VatMonthRecord | undefined> {
    return this.select().where('v.month', '=', month).executeTakeFirst();
  }

  /** Every month from `from` to `to` (first days) that has a row. */
  between(from: string, to: string): Promise<VatMonthRecord[]> {
    return this.select().where('v.month', '>=', from).where('v.month', '<=', to).orderBy('v.month').execute();
  }

  /** Which of these months (first days) are filed. */
  async filedAmong(months: string[]): Promise<string[]> {
    if (months.length === 0) return [];
    const rows = await this.db
      .selectFrom('vat_months')
      .select(sql<string>`to_char(month, 'YYYY-MM-DD')`.as('month'))
      .where('month', 'in', months)
      .where('filed_at', 'is not', null)
      .execute();
    return rows.map((row) => row.month);
  }

  async filedMonths(): Promise<string[]> {
    const rows = await this.db
      .selectFrom('vat_months')
      .select(sql<string>`to_char(month, 'YYYY-MM-DD')`.as('month'))
      .where('filed_at', 'is not', null)
      .orderBy('month')
      .execute();
    return rows.map((row) => row.month);
  }

  /** The first month after `month` that is not filed. */
  async nextOpenAfter(month: string): Promise<string> {
    const { rows } = await sql<{ month: string }>`
      select to_char(m, 'YYYY-MM-DD') as month
      from generate_series(${month}::date + interval '1 month', ${month}::date + interval '10 years', interval '1 month') as m
      where not exists (select 1 from vat_months v where v.month = m::date and v.filed_at is not null)
      order by m limit 1
    `.execute(this.db);
    return rows[0]!.month;
  }

  async saveTyped(month: string, values: { refund?: number; carriedIn?: number | null }, by: number): Promise<void> {
    await this.db
      .insertInto('vat_months')
      .values({ month, refund: values.refund ?? 0, carried_in: values.carriedIn ?? null, updated_by: by })
      .onConflict((conflict) =>
        conflict.column('month').doUpdateSet({
          ...(values.refund !== undefined && { refund: values.refund }),
          ...(values.carriedIn !== undefined && { carried_in: values.carriedIn }),
          updated_by: by,
          updated_at: new Date(),
        }),
      )
      .execute();
  }

  async file(month: string, figures: unknown, by: number): Promise<void> {
    await this.db
      .insertInto('vat_months')
      .values({ month, filed_at: new Date(), filed_by: by, figures: JSON.stringify(figures), updated_by: by })
      .onConflict((conflict) =>
        conflict.column('month').doUpdateSet({ filed_at: new Date(), filed_by: by, figures: JSON.stringify(figures), updated_by: by, updated_at: new Date() }),
      )
      .execute();
  }

  async reopen(month: string, by: number): Promise<void> {
    await this.db.updateTable('vat_months').set({ filed_at: null, filed_by: null, figures: null, updated_by: by, updated_at: new Date() }).where('month', '=', month).execute();
  }
}
