import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';

export interface DeviceRecord {
  user_id: number;
  kind: 'expo' | 'web';
  token: string;
  keys: { p256dh: string; auth: string } | null;
}

export interface NewDevice {
  kind: 'expo' | 'web';
  token: string;
  keys: { p256dh: string; auth: string } | null;
}

/** A notification claimed for pushing, with its owner's push settings. */
export interface ClaimedNotification {
  id: number;
  user_id: number;
  title: string;
  message: string;
  type: string | null;
  push_preferences: Record<string, boolean>;
}

/** Where push alerts go (devices) and which ones each person wants. */
export class PushRepository {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * One row per device. Logging in as someone else on the same device moves
   * the device to them, so alerts never reach the previous person.
   */
  async saveDevice(userId: number, device: NewDevice): Promise<void> {
    await this.db
      .insertInto('push_subscriptions')
      .values({ user_id: userId, kind: device.kind, token: device.token, keys: device.keys })
      .onConflict((oc) => oc.column('token').doUpdateSet({ user_id: userId, kind: device.kind, keys: device.keys }))
      .execute();
  }

  async removeDevice(userId: number, token: string): Promise<void> {
    await this.db.deleteFrom('push_subscriptions').where('user_id', '=', userId).where('token', '=', token).execute();
  }

  async removeDevicesByToken(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.db.deleteFrom('push_subscriptions').where('token', 'in', tokens).execute();
  }

  async devicesFor(userIds: number[]): Promise<DeviceRecord[]> {
    if (userIds.length === 0) return [];
    return this.db
      .selectFrom('push_subscriptions')
      .select(['user_id', 'kind', 'token', 'keys'])
      .where('user_id', 'in', userIds)
      .execute();
  }

  async markDevicesUsed(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.db.updateTable('push_subscriptions').set({ last_used_at: new Date() }).where('token', 'in', tokens).execute();
  }

  async countDevices(userId: number): Promise<number> {
    const row = await this.db
      .selectFrom('push_subscriptions')
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
    return Number(row.total);
  }

  async createTestNotification(userId: number, notification: { title: string; message: string; type: string }): Promise<void> {
    await this.db.insertInto('notifications').values({ user_id: userId, ...notification }).execute();
  }

  async preferences(userId: number): Promise<Record<string, boolean>> {
    const row = await this.db.selectFrom('users').select('push_preferences').where('id', '=', userId).executeTakeFirst();
    return row?.push_preferences ?? {};
  }

  async savePreferences(userId: number, preferences: Record<string, boolean>): Promise<void> {
    await this.db.updateTable('users').set({ push_preferences: preferences }).where('id', '=', userId).execute();
  }

  /**
   * Mark up to `limit` unpushed notifications as pushed and return them, in
   * one statement. SKIP LOCKED lets two servers run this at once without
   * both sending the same alert. Anything older than `since` is marked but
   * not returned: a stale alert is worse than none.
   */
  async claimUnpushed(since: Date, limit: number): Promise<ClaimedNotification[]> {
    await this.db
      .updateTable('notifications')
      .set({ pushed_at: new Date() })
      .where('pushed_at', 'is', null)
      .where('created_at', '<', since)
      .execute();

    const result = await sql<ClaimedNotification>`
      with claimed as (
        update notifications set pushed_at = now()
        where id in (
          select id from notifications
          where pushed_at is null
          order by id
          limit ${limit}
          for update skip locked
        )
        returning id, user_id, title, message, type
      )
      select claimed.*, u.push_preferences
      from claimed join users u on u.id = claimed.user_id
      where u.is_active and u.deleted_at is null
      order by claimed.id
    `.execute(this.db);
    return result.rows;
  }
}
