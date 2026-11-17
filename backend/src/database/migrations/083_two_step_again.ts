import { type Kysely, sql } from 'kysely';

/**
 * "Make them set it up again": a manager switches someone's two-step sign-in
 * off and asks them to set it up afresh. While `two_step_required` is true the
 * person gets no session: after the password (or a passkey) they land on the
 * setup (QR, first code, backup codes shown once to them alone), and the flag
 * clears when the first code is right.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // A constant default is only a catalogue change (no table rewrite); still, never wait long behind sign-ins.
  await sql`SET LOCAL lock_timeout = '10s'`.execute(db);
  await sql`ALTER TABLE users ADD COLUMN two_step_required BOOLEAN NOT NULL DEFAULT false`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users DROP COLUMN two_step_required`.execute(db);
}
