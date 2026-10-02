import type { DatabaseClient } from '../database/connection.js';
import type { UserRole } from '../database/types.js';

export interface InviteRecord {
  id: number;
  business_id: number;
  business_name: string;
  email: string;
  role: UserRole;
  invited_by_name: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export class InviteRepository {
  constructor(private readonly db: DatabaseClient) {}

  private baseQuery() {
    return this.db
      .selectFrom('invites as i')
      .innerJoin('businesses as b', 'b.id', 'i.business_id')
      .leftJoin('users as u', 'u.id', 'i.invited_by')
      .select([
        'i.id',
        'i.business_id',
        'b.name as business_name',
        'i.email',
        'i.role',
        'u.name as invited_by_name',
        'i.expires_at',
        'i.accepted_at',
        'i.revoked_at',
        'i.created_at',
      ]);
  }

  async create(invite: {
    businessId: number;
    email: string;
    role: UserRole;
    tokenHash: string;
    invitedBy: number;
    expiresAt: Date;
  }): Promise<number> {
    const row = await this.db
      .insertInto('invites')
      .values({
        business_id: invite.businessId,
        email: invite.email,
        role: invite.role,
        token_hash: invite.tokenHash,
        invited_by: invite.invitedBy,
        expires_at: invite.expiresAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  findById(id: number, businessId: number): Promise<InviteRecord | undefined> {
    return this.baseQuery().where('i.id', '=', id).where('i.business_id', '=', businessId).executeTakeFirst();
  }

  findByTokenHash(tokenHash: string): Promise<InviteRecord | undefined> {
    return this.baseQuery().where('i.token_hash', '=', tokenHash).executeTakeFirst();
  }

  /** Invites still waiting to be accepted, newest first. */
  findPending(businessId: number, now: Date): Promise<InviteRecord[]> {
    return this.baseQuery()
      .where('i.business_id', '=', businessId)
      .where('i.accepted_at', 'is', null)
      .where('i.revoked_at', 'is', null)
      .where('i.expires_at', '>', now)
      .orderBy('i.created_at', 'desc')
      .execute();
  }

  /** Cancel every open invite to this email, e.g. before sending a new one. */
  async revokeOpenFor(businessId: number, email: string): Promise<void> {
    await this.db
      .updateTable('invites')
      .set({ revoked_at: new Date() })
      .where('business_id', '=', businessId)
      .where('email', '=', email)
      .where('accepted_at', 'is', null)
      .where('revoked_at', 'is', null)
      .execute();
  }

  async revoke(id: number): Promise<void> {
    await this.db.updateTable('invites').set({ revoked_at: new Date() }).where('id', '=', id).execute();
  }

  async replaceToken(id: number, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.db.updateTable('invites').set({ token_hash: tokenHash, expires_at: expiresAt }).where('id', '=', id).execute();
  }

  /** True for the one caller that accepts it, so a double click can't make two accounts. */
  async markAccepted(id: number): Promise<boolean> {
    const result = await this.db
      .updateTable('invites')
      .set({ accepted_at: new Date() })
      .where('id', '=', id)
      .where('accepted_at', 'is', null)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }
}
