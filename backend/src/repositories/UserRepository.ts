import { sql } from 'kysely';
import { storedOnly } from '../utils/roles.js';
import type { DatabaseClient } from '../database/connection.js';
import type { Language } from '../i18n/language.js';
import type { NewUserRow, UserRole, UserRow, UserUpdate } from '../database/types.js';

export interface UserListFilters {
  role?: UserRole;
  limit: number;
  offset: number;
}

export class UserRepository {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * The person's active membership: in `businessId` when given and still theirs,
   * otherwise in their home business (users.business_id).
   */
  async membership(userId: number, homeBusinessId: number, businessId?: number): Promise<{ businessId: number; role: UserRole } | undefined> {
    const rows = await this.db
      .selectFrom('memberships')
      .select(['business_id', 'role'])
      .where('user_id', '=', userId)
      .where('is_active', '=', true)
      .where('business_id', 'in', [businessId ?? homeBusinessId, homeBusinessId])
      .execute();
    const row = rows.find((r) => r.business_id === businessId) ?? rows.find((r) => r.business_id === homeBusinessId);
    return row && { businessId: row.business_id, role: row.role };
  }

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

  /** Who has at least one passkey (People shows the reset only for them). */
  async withPasskeys(userIds: number[]): Promise<Set<number>> {
    if (userIds.length === 0) return new Set();
    const rows = await this.db.selectFrom('passkeys').select('user_id').distinct().where('user_id', 'in', userIds).execute();
    return new Set(rows.map((row) => row.user_id));
  }

  async findAll(filters: UserListFilters): Promise<{ users: UserRow[]; total: number }> {
    // 4VD's developer is visible everywhere (row security) but listed only in his own business.
    let query = this.db
      .selectFrom('users')
      .where('deleted_at', 'is', null)
      .where((eb) => eb.or([eb('is_platform_developer', '=', false), eb('business_id', '=', sql<number>`current_business_id()`)]));
    if (filters.role === 'developer') query = query.where('is_platform_developer', '=', true);
    else if (filters.role) query = query.where('role', '=', filters.role);

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
  /** Active 4VD developers, who hear when the server runs into errors. */
  developers(): Promise<Array<{ email: string; name: string; language: Language }>> {
    return this.db
      .selectFrom('users')
      .select(['email', 'name', 'language'])
      .where('is_platform_developer', '=', true)
      .where('is_active', '=', true)
      .where('deleted_at', 'is', null)
      .execute();
  }

  async createBusiness(name: string): Promise<number> {
    const row = await this.db.insertInto('businesses').values({ name }).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }

  /**
   * Every business the person may open, with their role there: their active
   * memberships, or for 4VD's developer every business (as 'developer').
   */
  async businessesOf(user: { id: number; is_platform_developer: boolean }): Promise<{ id: number; name: string; role: UserRole }[]> {
    if (user.is_platform_developer) {
      const all = await this.db.selectFrom('businesses').select(['id', 'name']).orderBy('name').orderBy('id').execute();
      return all.map((business) => ({ ...business, role: 'developer' as const }));
    }
    return this.db
      .selectFrom('memberships as m')
      .innerJoin('businesses as b', 'b.id', 'm.business_id')
      .select(['b.id', 'b.name', 'm.role'])
      .where('m.user_id', '=', user.id)
      .where('m.is_active', '=', true)
      .orderBy('b.name')
      .orderBy('b.id')
      .execute();
  }

  async businessName(businessId: number): Promise<string | undefined> {
    const row = await this.db.selectFrom('businesses').select('name').where('id', '=', businessId).executeTakeFirst();
    return row?.name;
  }

  /** Active people of the business's own with one of the roles (to keep at least one main admin); 4VD's developer doesn't count. */
  async countActive(roles: UserRole[]): Promise<number> {
    const stored = storedOnly(roles);
    if (stored.length === 0) return 0;
    const row = await this.db
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .where('role', 'in', stored)
      .where('is_platform_developer', '=', false)
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
