import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';

/** Settings key the launch wipe writes, so the checklist knows it happened. */
export const WIPED_AT_KEY = 'shop_data_wiped_at';

export interface LaunchFacts {
  wiped_at: string | null;
  products: string;
  sales: string;
  has_address: boolean;
  has_phone: boolean;
  owners: string;
  owners_with_weekly_email: string;
  employees: string;
}

export class LaunchRepository {
  constructor(private readonly db: DatabaseClient) {}

  async facts(): Promise<LaunchFacts> {
    const result = await sql<LaunchFacts>`
      select
        (select value #>> '{}' from settings where key = ${WIPED_AT_KEY}) as wiped_at,
        (select count(*) from products) as products,
        (select count(*) from sales) as sales,
        coalesce((select address is not null and address <> '' from businesses order by id limit 1), false) as has_address,
        coalesce((select phone is not null and phone <> '' from businesses order by id limit 1), false) as has_phone,
        (select count(*) from users where role = 'owner' and is_active and deleted_at is null) as owners,
        (select count(*) from users where role = 'owner' and is_active and deleted_at is null and email_weekly_report) as owners_with_weekly_email,
        (select count(*) from users where role = 'employee' and is_active and deleted_at is null) as employees
    `.execute(this.db);
    return result.rows[0]!;
  }
}
