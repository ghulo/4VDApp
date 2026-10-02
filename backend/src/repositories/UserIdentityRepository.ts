import type { DatabaseClient } from '../database/connection.js';

type Provider = 'google' | 'apple';

export class UserIdentityRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findUserId(provider: Provider, subject: string): Promise<number | undefined> {
    const row = await this.db
      .selectFrom('user_identities')
      .select('user_id')
      .where('provider', '=', provider)
      .where('subject', '=', subject)
      .executeTakeFirst();
    return row?.user_id;
  }

  async link(userId: number, provider: Provider, subject: string, email: string): Promise<void> {
    await this.db
      .insertInto('user_identities')
      .values({ user_id: userId, provider, subject, email })
      .onConflict((oc) => oc.columns(['provider', 'subject']).doNothing())
      .execute();
  }

  async unlink(userId: number, provider: Provider): Promise<void> {
    await this.db.deleteFrom('user_identities').where('user_id', '=', userId).where('provider', '=', provider).execute();
  }

  async emailFor(userId: number, provider: Provider): Promise<string | null> {
    const row = await this.db
      .selectFrom('user_identities')
      .select('email')
      .where('user_id', '=', userId)
      .where('provider', '=', provider)
      .executeTakeFirst();
    return row?.email ?? null;
  }
}
