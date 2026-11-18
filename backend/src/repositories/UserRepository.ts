import { sql } from 'kysely';
import { AppError } from '../errors/httpErrors.js';
import { storedOnly } from '../utils/roles.js';
import { currentBusinessId, runAsSystem } from '../database/businessContext.js';
import type { DatabaseClient } from '../database/connection.js';
import type { Language } from '../i18n/language.js';
import type { NewUserRow, StoredRole, UserRole, UserRow, UserUpdate } from '../database/types.js';

export interface UserListFilters {
  role?: UserRole;
  limit: number;
  offset: number;
}

export class UserRepository {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * The person's active membership: in `businessId` when given and still theirs,
   * otherwise in their home business (users.business_id), otherwise (blocked
   * at home) the first other business they are active in.
   */
  async membership(userId: number, homeBusinessId: number, businessId?: number): Promise<{ businessId: number; role: UserRole } | undefined> {
    const rows = await this.db
      .selectFrom('memberships')
      .select(['business_id', 'role'])
      .where('user_id', '=', userId)
      .where('is_active', '=', true)
      .where('removed_at', 'is', null)
      .orderBy('business_id')
      .execute();
    const row = rows.find((r) => r.business_id === businessId) ?? rows.find((r) => r.business_id === homeBusinessId) ?? rows[0];
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

  /** Someone who works for the current business, with their role and active state here (people view). */
  person(id: number): Promise<UserRow | undefined> {
    return this.db.selectFrom('people').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
  }

  /** Someone of the current business by email (an invite to them would be pointless). */
  personByEmail(email: string): Promise<UserRow | undefined> {
    return this.db.selectFrom('people').selectAll().where('email', '=', email.toLowerCase()).where('deleted_at', 'is', null).executeTakeFirst();
  }

  /**
   * A manager acting on someone in the current business: both with their role
   * here (4VD's developer keeps his own row), and whether this business is the
   * person's home (only the home business changes their account itself).
   */
  async inThisBusiness(actorId: number, targetId: number): Promise<{ actor?: UserRow; target?: UserRow; home: boolean }> {
    const [account, here, target] = await Promise.all([this.findById(actorId), this.person(actorId), this.person(targetId)]);
    const actor = account?.is_platform_developer ? account : here;
    return { actor, target, home: target !== undefined && target.business_id === currentBusinessId() };
  }

  async findAll(filters: UserListFilters): Promise<{ users: UserRow[]; total: number }> {
    // Everyone with a membership here; 4VD's developer only where he is a member himself.
    let query = this.db.selectFrom('people').where('deleted_at', 'is', null);
    if (filters.role === 'developer') query = query.where('is_platform_developer', '=', true);
    else if (filters.role) query = query.where('role', '=', filters.role);

    const [users, count] = await Promise.all([
      query.selectAll().orderBy('name').limit(filters.limit).offset(filters.offset).execute(),
      query.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
    ]);
    return { users, total: Number(count.total) };
  }

  /** Role or active state in the current business only (someone whose home is another business). */
  async updateMembership(userId: number, changes: { role?: StoredRole; is_active?: boolean }): Promise<boolean> {
    const result = await this.db
      .updateTable('memberships')
      .set(changes)
      .where('user_id', '=', userId)
      .where('business_id', '=', sql<number>`current_business_id()`)
      .where('removed_at', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  /** Takes someone off the current business; the row stays so their name still shows on past work. */
  async removeMembership(userId: number): Promise<boolean> {
    const result = await this.db
      .updateTable('memberships')
      .set({ is_active: false, removed_at: new Date() })
      .where('user_id', '=', userId)
      .where('business_id', '=', sql<number>`current_business_id()`)
      .where('removed_at', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  /** Someone who already has an account joins another business (an accepted invite). */
  async join(userId: number, businessId: number, role: StoredRole): Promise<void> {
    await this.db
      .insertInto('memberships')
      .values({ user_id: userId, business_id: businessId, role })
      .onConflict((oc) => oc.columns(['user_id', 'business_id']).doUpdateSet({ role, is_active: true, removed_at: null }))
      .execute();
  }

  /** Every account with this email, deleted ones included (an email belongs to one account, ever). */
  findAnyByEmail(email: string): Promise<UserRow | undefined> {
    return this.db.selectFrom('users').selectAll().where('email', '=', email.toLowerCase()).executeTakeFirst();
  }

  async create(user: NewUserRow): Promise<UserRow> {
    try {
      return await this.db.insertInto('users').values(user).returningAll().executeTakeFirstOrThrow();
    } catch (error) {
      if (isEmailTaken(error)) throw new AppError(`${user.email} already has a 4VD account.`, 409, EMAIL_TAKEN);
      throw error;
    }
  }

  /**
   * A deleted account comes back for a new invite: a fresh start with the new
   * name and password in the invite's business only. Everything personal from
   * before goes (phone, photo, settings, PIN, two-step, passkeys, Google link,
   * sessions, open links, push devices), and every old membership stays removed.
   * Undefined when the account is not deleted (any more).
   */
  async revive(
    id: number,
    fresh: { name: string; passwordHash: string | null; role: StoredRole; language: Language; businessId: number },
  ): Promise<UserRow | undefined> {
    const now = new Date();
    const user = await this.db
      .updateTable('users')
      .set({
        name: fresh.name,
        password_hash: fresh.passwordHash,
        role: fresh.role,
        language: fresh.language,
        business_id: fresh.businessId,
        is_active: true,
        deleted_at: null,
        email_verified_at: now,
        phone: null,
        avatar_media_id: null,
        theme: 'system',
        email_weekly_report: true,
        push_preferences: {},
        last_login_at: null,
        monthly_target: null,
        commission_percent: null,
        pin_hash: null,
        pin_set_at: null,
        pin_cleared_at: null,
        totp_secret: null,
        totp_pending: null,
        totp_enabled_at: null,
        totp_last_step: null,
        totp_recovery: sql<string[]>`'{}'::text[]`,
        two_step_required: false,
        // A fresh start: tokens signed before now no longer count (requireAuth).
        sessions_from: now,
        updated_at: now,
      })
      .where('id', '=', id)
      .where('deleted_at', 'is not', null)
      .where('is_platform_developer', '=', false)
      .returningAll()
      .executeTakeFirst();
    if (!user) return undefined;
    for (const table of ['refresh_tokens', 'account_tokens', 'user_identities', 'passkeys', 'push_subscriptions'] as const) {
      await this.db.deleteFrom(table).where('user_id', '=', id).execute();
    }
    await this.db
      .updateTable('memberships')
      .set({ is_active: false, removed_at: now })
      .where('user_id', '=', id)
      .where('business_id', '<>', fresh.businessId)
      .execute();
    await this.db
      .insertInto('memberships')
      .values({ user_id: id, business_id: fresh.businessId, role: fresh.role, is_active: true })
      .onConflict((oc) => oc.columns(['user_id', 'business_id']).doUpdateSet({ role: fresh.role, is_active: true, removed_at: null }))
      .execute();
    return user;
  }

  /** Every business the person ever had a membership in, removed ones included. */
  async everyBusinessOf(userId: number): Promise<number[]> {
    const rows = await this.db.selectFrom('memberships').select('business_id').where('user_id', '=', userId).execute();
    return rows.map((row) => row.business_id);
  }

  /** A revived account's own leftovers in the business open now (favourites, notifications, report emails, assistant chats). */
  async forgetPersonalHere(userId: number): Promise<void> {
    for (const table of ['favorites', 'notifications', 'report_subscriptions', 'assistant_chats'] as const) {
      await this.db.deleteFrom(table).where('user_id', '=', userId).execute();
    }
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

  /** The part after the + in the business's bill address. */
  async shortName(businessId: number): Promise<string | null> {
    const row = await this.db.selectFrom('businesses').select('short_name').where('id', '=', businessId).executeTakeFirst();
    return row?.short_name ?? null;
  }

  async businessName(businessId: number): Promise<string | undefined> {
    const row = await this.db.selectFrom('businesses').select('name').where('id', '=', businessId).executeTakeFirst();
    return row?.name;
  }

  /** Active people of the current business with one of the roles (to keep at least one main admin); 4VD's developer doesn't count. */
  async countActive(roles: UserRole[]): Promise<number> {
    const stored = storedOnly(roles);
    if (stored.length === 0) return 0;
    const row = await this.db
      .selectFrom('people')
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .where('role', 'in', stored)
      .where('is_platform_developer', '=', false)
      .where('is_active', '=', true)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(row.total);
  }

  /**
   * The other businesses where this person is the only active main admin
   * (deleting their account would leave them with none). Read before any
   * business applies, since people of other businesses are hidden otherwise.
   */
  lastMainAdminElsewhere(userId: number, businessId: number): Promise<string[]> {
    return runAsSystem(async () => {
      const { rows } = await sql<{ name: string }>`
        select b.name from memberships m join businesses b on b.id = m.business_id
        where m.user_id = ${userId} and m.business_id <> ${businessId}
          and m.role = 'main_admin' and m.is_active and m.removed_at is null
          and not exists (
            select 1 from memberships o join users u on u.id = o.user_id
            where o.business_id = m.business_id and o.user_id <> ${userId}
              and o.role = 'main_admin' and o.is_active and o.removed_at is null
              and u.deleted_at is null and u.is_active and not u.is_platform_developer)
        order by b.name`.execute(this.db);
      return rows.map((row) => row.name);
    });
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

/** The code a taken email answers with; callers turn it into their own clear 409. */
export const EMAIL_TAKEN = 'EMAIL_TAKEN';

/** Postgres's unique-violation on the users email: two accounts never share one. */
export function isEmailTaken(error: unknown): boolean {
  const pg = error as { code?: string; constraint?: string };
  return pg?.code === '23505' && pg.constraint === 'users_email_key';
}
