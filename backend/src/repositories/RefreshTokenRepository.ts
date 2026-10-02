import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';

export class RefreshTokenRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** Without a session id this starts a new session (a new device); with one it continues it. */
  async create(
    userId: number,
    tokenHash: string,
    expiresAt: Date,
    session: { sessionId?: string; userAgent?: string | null; ip?: string | null } = {},
  ): Promise<void> {
    await this.db
      .insertInto('refresh_tokens')
      .values({
        user_id: userId,
        token_hash: tokenHash,
        expires_at: expiresAt,
        ...(session.sessionId && { session_id: session.sessionId }),
        user_agent: session.userAgent?.slice(0, 500) ?? null,
        ip: session.ip ?? null,
        last_used_at: new Date(),
      })
      .execute();
  }

  /**
   * Atomically revoke a token that is still valid and return its owner.
   * Doing the check and the revoke in one UPDATE means two parallel refresh
   * calls with the same token cannot both succeed.
   */
  async consumeValid(
    tokenHash: string,
  ): Promise<{ userId: number; sessionId: string; userAgent: string | null } | undefined> {
    const row = await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: new Date() })
      .where('token_hash', '=', tokenHash)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', new Date())
      .returning(['user_id', 'session_id', 'user_agent'])
      .executeTakeFirst();
    return row ? { userId: row.user_id, sessionId: row.session_id, userAgent: row.user_agent } : undefined;
  }

  async revoke(tokenHash: string, userId: number): Promise<void> {
    await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: new Date() })
      .where('token_hash', '=', tokenHash)
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  /** Devices still logged in: one row per session, from its newest token. */
  async activeSessions(userId: number): Promise<
    Array<{ session_id: string; user_agent: string | null; ip: string | null; last_used_at: Date | null; started_at: Date }>
  > {
    const result = await sql<{
      session_id: string;
      user_agent: string | null;
      ip: string | null;
      last_used_at: Date | null;
      started_at: Date;
    }>`
      select distinct on (session_id)
        session_id, user_agent, ip, last_used_at,
        min(created_at) over (partition by session_id) as started_at
      from refresh_tokens
      where user_id = ${userId}
        and session_id in (
          select session_id from refresh_tokens
          where user_id = ${userId} and revoked_at is null and expires_at > now()
        )
      order by session_id, created_at desc
    `.execute(this.db);
    return result.rows;
  }

  /** End one device's session. False when it isn't this person's. */
  async revokeSession(userId: number, sessionId: string): Promise<boolean> {
    const result = await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: new Date() })
      .where('user_id', '=', userId)
      .where('session_id', '=', sessionId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  /** End every session except `keepSessionId` (the device asking). */
  async revokeAllForUserExcept(userId: number, keepSessionId: string | undefined): Promise<void> {
    let query = this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: new Date() })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null);
    if (keepSessionId) query = query.where('session_id', '!=', keepSessionId);
    await query.execute();
  }

  async revokeAllForUser(userId: number): Promise<void> {
    await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: new Date() })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
  }
}
