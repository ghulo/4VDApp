import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import type { UserRole } from '../database/types.js';

export interface PinPersonRow {
  id: number;
  name: string;
  role: UserRole;
  pin_hash: string;
  /** Wrong PINs since the last right one, the last password sign-in, a manager's unlock, or 15 minutes ago. */
  recent_failures: number;
  /** Wrong PINs in this business in the last 24 hours, since a manager last unlocked it here. A right PIN or a sign-in doesn't reset these. */
  day_failures: number;
}

/** Wrong PINs here since a manager's unlock, within the day window, per person. */
const dayFailures = (dayStart: Date) => sql<number>`(select count(*)::int from pin_attempts a
  where a.user_id = u.id and not a.ok and a.business_id = (select current_business_id())
    and a.at > greatest(${dayStart}::timestamptz, coalesce(m.pin_unlocked_at, '-infinity')))`;

/** Counter PINs: who has one, every PIN typed (for the locks), and owners' one-time rabat approvals. */
export class PinRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** Active people with a PIN, each with their recent wrong PINs and today's. */
  async people(windowStart: Date, dayStart: Date): Promise<PinPersonRow[]> {
    const { rows } = await sql<PinPersonRow>`
      select u.id, u.name, u.role, u.pin_hash,
        (select count(*)::int from pin_attempts a
          where a.user_id = u.id and not a.ok
            and a.at > greatest(${windowStart}::timestamptz, coalesce(u.pin_cleared_at, '-infinity'), coalesce(m.pin_unlocked_at, '-infinity'),
              coalesce((select max(b.at) from pin_attempts b where b.user_id = u.id and b.ok), '-infinity'))) as recent_failures,
        ${dayFailures(dayStart)} as day_failures
      from people u
      join memberships m on m.user_id = u.id and m.business_id = (select current_business_id())
      where u.is_active and u.deleted_at is null and u.pin_hash is not null
      order by u.name
    `.execute(this.db);
    return rows;
  }

  /** People here whose PIN has hit the daily cap (whatever their role or access), for To do and People. */
  async dayLocked(dayStart: Date, cap: number): Promise<Array<{ id: number; name: string }>> {
    const { rows } = await sql<{ id: number; name: string }>`
      select u.id, u.name from people u
      join memberships m on m.user_id = u.id and m.business_id = (select current_business_id())
      where u.deleted_at is null and u.pin_hash is not null and ${dayFailures(dayStart)} >= ${cap}
      order by u.name
    `.execute(this.db);
    return rows;
  }

  /** A manager unlocks someone's PIN in this business: wrong PINs before now stop counting (both locks). */
  async unlock(userId: number): Promise<void> {
    await sql`update memberships set pin_unlocked_at = now() where user_id = ${userId} and business_id = (select current_business_id())`.execute(this.db);
  }

  /** Wrong PINs typed on one PC since `since`. */
  async deviceFailures(deviceId: string, since: Date): Promise<number> {
    const row = await this.db
      .selectFrom('pin_attempts')
      .select((eb) => eb.fn.countAll<string>().as('failures'))
      .where('device_id', '=', deviceId)
      .where('ok', '=', false)
      .where('at', '>', since)
      .executeTakeFirstOrThrow();
    return Number(row.failures);
  }

  async recordAttempt(attempt: { userId: number; deviceId: string; purpose: 'switch' | 'rabat' | 'pay_later'; ok: boolean }): Promise<void> {
    await this.db
      .insertInto('pin_attempts')
      .values({ user_id: attempt.userId, device_id: attempt.deviceId, purpose: attempt.purpose, ok: attempt.ok })
      .execute();
  }

  async setPin(userId: number, pinHash: string | null): Promise<void> {
    await this.db
      .updateTable('users')
      .set({ pin_hash: pinHash, pin_set_at: pinHash ? new Date() : null, updated_at: new Date() })
      .where('id', '=', userId)
      .execute();
  }

  async createApproval(
    approval: { id: string; approvedBy: number; askedBy: number; basketId: string; expiresAt: Date } & (
      | { purpose: 'rabat'; percent: number }
      | { purpose: 'pay_later'; customerId: number; amount: number }
    ),
  ): Promise<void> {
    await this.db
      .insertInto('rabat_approvals')
      .values({
        id: approval.id,
        approved_by: approval.approvedBy,
        asked_by: approval.askedBy,
        basket_id: approval.basketId,
        purpose: approval.purpose,
        percent: approval.purpose === 'rabat' ? approval.percent : null,
        customer_id: approval.purpose === 'pay_later' ? approval.customerId : null,
        amount: approval.purpose === 'pay_later' ? approval.amount : null,
        expires_at: approval.expiresAt,
      })
      .execute();
  }

  async customerName(id: number): Promise<string | undefined> {
    return (await this.db.selectFrom('customers').select('name').where('id', '=', id).executeTakeFirst())?.name;
  }

  /** Use an owner's yes to a pay-later sale once: by who asked, in time, for this customer and no more than allowed. */
  async consumePayLater(id: string, askedBy: number, customerId: number, amount: number): Promise<{ approvedBy: number } | undefined> {
    const row = await this.db
      .updateTable('rabat_approvals')
      .set({ used_at: new Date() })
      .where('id', '=', id)
      .where('purpose', '=', 'pay_later')
      .where('asked_by', '=', askedBy)
      .where('customer_id', '=', customerId)
      .where('used_at', 'is', null)
      .where('expires_at', '>', new Date())
      .where(sql<boolean>`amount >= ${amount}`)
      .returning('approved_by')
      .executeTakeFirst();
    return row ? { approvedBy: row.approved_by } : undefined;
  }

  /**
   * Use an approval once: only by the person who asked for it, before it runs
   * out, and for no more than the rabat allowed. Returns who allowed it.
   */
  async consumeApproval(id: string, askedBy: number, percent: number): Promise<{ approvedBy: number } | undefined> {
    const row = await this.db
      .updateTable('rabat_approvals')
      .set({ used_at: new Date() })
      .where('id', '=', id)
      .where('purpose', '=', 'rabat')
      .where('asked_by', '=', askedBy)
      .where('used_at', 'is', null)
      .where('expires_at', '>', new Date())
      .where(sql<boolean>`percent >= ${percent}`)
      .returning('approved_by')
      .executeTakeFirst();
    return row ? { approvedBy: row.approved_by } : undefined;
  }
}
