import type { DatabaseClient } from '../database/connection.js';
import type { AccountTokenPurpose } from '../database/types.js';

export class AccountTokenRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** A new link for this purpose; any earlier unused one for the same person stops working. */
  async create(token: {
    userId: number;
    purpose: AccountTokenPurpose;
    tokenHash: string;
    expiresAt: Date;
    newEmail?: string;
  }): Promise<void> {
    await this.db
      .updateTable('account_tokens')
      .set({ used_at: new Date() })
      .where('user_id', '=', token.userId)
      .where('purpose', '=', token.purpose)
      .where('used_at', 'is', null)
      .execute();
    await this.db
      .insertInto('account_tokens')
      .values({
        user_id: token.userId,
        purpose: token.purpose,
        token_hash: token.tokenHash,
        expires_at: token.expiresAt,
        new_email: token.newEmail ?? null,
      })
      .execute();
  }

  /** Whether a link for this purpose was sent to this person since `since`. */
  async sentSince(userId: number, purpose: AccountTokenPurpose, since: Date): Promise<boolean> {
    const row = await this.db
      .selectFrom('account_tokens')
      .select('id')
      .where('user_id', '=', userId)
      .where('purpose', '=', purpose)
      .where('created_at', '>', since)
      .executeTakeFirst();
    return row !== undefined;
  }

  /** Use a link once: marks it used and returns it, or undefined when it no longer works. */
  async consume(
    tokenHash: string,
    purpose: AccountTokenPurpose,
  ): Promise<{ userId: number; newEmail: string | null } | undefined> {
    const row = await this.db
      .updateTable('account_tokens')
      .set({ used_at: new Date() })
      .where('token_hash', '=', tokenHash)
      .where('purpose', '=', purpose)
      .where('used_at', 'is', null)
      .where('expires_at', '>', new Date())
      .returning(['user_id', 'new_email'])
      .executeTakeFirst();
    return row ? { userId: row.user_id, newEmail: row.new_email } : undefined;
  }
}
