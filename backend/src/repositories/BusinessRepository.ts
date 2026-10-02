import type { DatabaseClient } from '../database/connection.js';
import type { BusinessesTable } from '../database/types.js';
import type { Selectable, Updateable } from 'kysely';

export type BusinessRow = Selectable<BusinessesTable>;

export class BusinessRepository {
  constructor(private readonly db: DatabaseClient) {}

  findById(id: number): Promise<BusinessRow | undefined> {
    return this.db.selectFrom('businesses').selectAll().where('id', '=', id).executeTakeFirst();
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
