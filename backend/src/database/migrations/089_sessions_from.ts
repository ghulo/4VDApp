import { type Kysely, sql } from 'kysely';

/**
 * A deleted account can come back for a new invite (InviteService.revive). Its
 * old sign-in tokens last days, so users.sessions_from says which ones still
 * count: a token signed before it is refused (requireAuth). Null (everyone
 * else) means no such check. people gets the column too (see 085).
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

const view = (withSessionsFrom: boolean) => sql`
  CREATE OR REPLACE VIEW people WITH (security_invoker = true) AS
  SELECT ${sql.raw(USER_COLUMNS.map((column) => `u.${column}`).join(', '))}, m.role, m.is_active${sql.raw(withSessionsFrom ? ', u.sessions_from' : '')}
  FROM users u
  JOIN memberships m ON m.user_id = u.id AND m.business_id = (SELECT current_business_id()) AND m.removed_at IS NULL
`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '10s'`.execute(db);
  await sql`ALTER TABLE users ADD COLUMN sessions_from TIMESTAMPTZ`.execute(db);
  // A new view column can only go last, after role and is_active.
  await view(true).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP VIEW people`.execute(db);
  await view(false).execute(db);
  await sql`ALTER TABLE users DROP COLUMN sessions_from`.execute(db);
}
