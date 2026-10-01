import type { DatabaseClient } from '../database/connection.js';

export class RefreshTokenRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(userId: number, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.db
      .insertInto('refresh_tokens')
      .values({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt })
      .execute();
  }

  /**
   * Atomically revoke a token that is still valid and return its owner.
   * Doing the check and the revoke in one UPDATE means two parallel refresh
   * calls with the same token cannot both succeed.
   */
  async consumeValid(tokenHash: string): Promise<{ userId: number } | undefined> {
    const row = await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: new Date() })
      .where('token_hash', '=', tokenHash)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', new Date())
      .returning('user_id')
      .executeTakeFirst();
    return row ? { userId: row.user_id } : undefined;
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

  async revokeAllForUser(userId: number): Promise<void> {
    await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: new Date() })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
  }
}
