import { type Kysely, sql } from 'kysely';

/**
 * pg_dump (the nightly backup) and pg_restore run with an empty search_path.
 * Row security's app_maintenance() named app_is_owner() without its schema, so
 * every read of a business table failed there and the backup stopped (since 082).
 * Name the schema in it, and pin the search path of the trigger functions that
 * name tables or functions without one.
 */
const TRIGGER_FUNCTIONS = ['ledger_enqueue()', 'copy_user_to_membership()', 'guard_platform_developer()', 'keep_support_log()'];

export async function up(db: Kysely<unknown>): Promise<void> {
  // Stays a plain SQL function (no SET) so the planner can still inline it into every policy.
  await sql`
    CREATE OR REPLACE FUNCTION app_maintenance() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
      SELECT current_setting('app.maintenance', true) = 'on' AND public.app_is_owner()
    $$
  `.execute(db);
  for (const fn of TRIGGER_FUNCTIONS) await sql.raw(`ALTER FUNCTION public.${fn} SET search_path = public`).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const fn of TRIGGER_FUNCTIONS) await sql.raw(`ALTER FUNCTION public.${fn} RESET search_path`).execute(db);
  await sql`
    CREATE OR REPLACE FUNCTION app_maintenance() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
      SELECT current_setting('app.maintenance', true) = 'on' AND app_is_owner()
    $$
  `.execute(db);
}
