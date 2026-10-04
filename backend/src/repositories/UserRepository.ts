import type { DatabaseClient } from '../database/connection.js';
import type { Language } from '../i18n/language.js';
import type { NewUserRow, UserRole, UserRow, UserUpdate } from '../database/types.js';
import { OVERSEER_ROLES } from '../utils/roles.js';

export interface UserListFilters {
  role?: UserRole;
  limit: number;
  offset: number;
}

export class UserRepository {
  constructor(private readonly db: DatabaseClient) {}

  findById(id: number): Promise<UserRow | undefined> {
    return this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  findByEmail(email: string): Promise<UserRow | undefined> {
    return this.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email.toLowerCase())
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  async findAll(filters: UserListFilters): Promise<{ users: UserRow[]; total: number }> {
    let query = this.db.selectFrom('users').where('deleted_at', 'is', null);
    if (filters.role) query = query.where('role', '=', filters.role);

    const [users, count] = await Promise.all([
      query.selectAll().orderBy('name').limit(filters.limit).offset(filters.offset).execute(),
      query.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
    ]);
    return { users, total: Number(count.total) };
  }

  create(user: NewUserRow): Promise<UserRow> {
    return this.db.insertInto('users').values(user).returningAll().executeTakeFirstOrThrow();
  }

  update(id: number, changes: UserUpdate): Promise<UserRow | undefined> {
    return this.db
      .updateTable('users')
      .set({ ...changes, updated_at: new Date() })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returningAll()
      .executeTakeFirst();
  }

  /** Active people who oversee the shop and want the Monday report email. */
  /** Active developers, who hear when the server runs into errors. */
  developers(): Promise<Array<{ email: string; name: string; language: Language }>> {
    return this.db
      .selectFrom('users')
      .select(['email', 'name', 'language'])
      .where('role', '=', 'developer')
      .where('is_active', '=', true)
      .where('deleted_at', 'is', null)
      .execute();
  }

  weeklyReportRecipients(): Promise<Array<{ email: string; name: string; language: Language }>> {
    return this.db
      .selectFrom('users')
      .select(['email', 'name', 'language'])
      .where('role', 'in', OVERSEER_ROLES)
      .where('is_active', '=', true)
      .where('deleted_at', 'is', null)
      .where('email_weekly_report', '=', true)
      .execute();
  }

  async createBusiness(name: string): Promise<number> {
    const row = await this.db.insertInto('businesses').values({ name }).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }

  async businessName(businessId: number): Promise<string | undefined> {
    const row = await this.db.selectFrom('businesses').select('name').where('id', '=', businessId).executeTakeFirst();
    return row?.name;
  }

  /** Active people with one of the roles (e.g. to keep at least one developer). */
  async countActive(roles: UserRole[]): Promise<number> {
    const row = await this.db
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .where('role', 'in', roles)
      .where('is_active', '=', true)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(row.total);
  }

  async softDelete(id: number): Promise<boolean> {
    const result = await this.db
      .updateTable('users')
      .set({ deleted_at: new Date(), is_active: false, updated_at: new Date() })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }
}
