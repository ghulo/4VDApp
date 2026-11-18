import { type Kysely, sql } from 'kysely';

/**
 * Many businesses, phase 5d: `people` is everyone who works for the current
 * business, with their role and whether they are active *in this business*
 * (from memberships), not in their home business (users.role, users.is_active).
 *
 * - Lists of people, "who has this role" queries and the last-main-admin check
 *   read `people`; sign-in and account details keep reading `users`.
 * - security_invoker: the view reads users as the person asking, so the users
 *   row security still applies.
 * - The column list is fixed when the view is made. A new column on users that
 *   people lists need means recreating the view (tests/peopleView.test.ts
 *   fails until it matches users), and dropping a users column means dropping
 *   and recreating the view in that migration.
 * - memberships.removed_at: someone taken off a business that isn't their
 *   home. The row stays so their name still shows on what they did there;
 *   people leaves them out.
 */

const USER_COLUMNS = [
  'id',
  'email',
  'password_hash',
  'name',
  'created_at',
  'updated_at',
  'deleted_at',
  'monthly_target',
  'commission_percent',
  'push_preferences',
  'business_id',
  'email_verified_at',
  'phone',
  'avatar_media_id',
  'theme',
  'last_login_at',
  'email_weekly_report',
  'language',
  'pin_hash',
  'pin_set_at',
  'pin_cleared_at',
  'totp_secret',
  'totp_pending',
  'totp_enabled_at',
  'totp_last_step',
  'totp_recovery',
  'is_platform_developer',
  'two_step_required',
];

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '10s'`.execute(db);
  await sql`ALTER TABLE memberships ADD COLUMN removed_at TIMESTAMPTZ`.execute(db);
  const columns = sql.raw(USER_COLUMNS.map((column) => `u.${column}`).join(', '));
  await sql`
    CREATE VIEW people WITH (security_invoker = true) AS
    SELECT ${columns}, m.role, m.is_active
    FROM users u
    JOIN memberships m ON m.user_id = u.id AND m.business_id = (SELECT current_business_id()) AND m.removed_at IS NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP VIEW people`.execute(db);
  await sql`ALTER TABLE memberships DROP COLUMN removed_at`.execute(db);
}
