import type { DatabaseClient } from '../database/connection.js';
import type { BusinessesTable } from '../database/types.js';
import { sql, type Selectable, type Updateable } from 'kysely';

export type BusinessRow = Selectable<BusinessesTable>;

export class BusinessRepository {
  constructor(private readonly db: DatabaseClient) {}

  findById(id: number): Promise<BusinessRow | undefined> {
    return this.db.selectFrom('businesses').selectAll().where('id', '=', id).executeTakeFirst();
  }

  /** A business by the short name in its links (bills+<short>@, ?b=<short>). */
  findByShortName(shortName: string): Promise<BusinessRow | undefined> {
    return this.db.selectFrom('businesses').selectAll().where('short_name', '=', shortName).executeTakeFirst();
  }

  /** What this business has set up, so screens can leave out what doesn't apply: an open carwash, TREFIN's history. */
  async setUp(id: number): Promise<{ carwash: boolean; trefin: boolean }> {
    const row = await sql<{ carwash: boolean; trefin: boolean }>`
      select
        exists (select 1 from carwashes where business_id = ${id} and archived_at is null) as carwash,
        exists (select 1 from trefin_stock_documents where business_id = ${id}) as trefin
    `.execute(this.db);
    return row.rows[0] ?? { carwash: false, trefin: false };
  }

  async update(id: number, changes: Updateable<BusinessesTable>): Promise<BusinessRow> {
    return this.db
      .updateTable('businesses')
      .set({ ...changes, updated_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
