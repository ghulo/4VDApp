import { type Kysely, sql } from 'kysely';

/**
 * Many businesses, phase 4: the database itself keeps each business's rows to
 * that business (row-level security), so a query that forgets to filter still
 * can't show or change another business's data.
 *
 * - `current_business_id()` no longer falls back to the first business: work
 *   that hasn't named its business sees no rows, and its inserts fail.
 * - Every table with a business_id: rows are visible and writable only for the
 *   current business. FORCE makes this apply to the table owner too (the app's
 *   own database user); only a superuser would skip it, and the API refuses to
 *   start as one in production.
 * - `app.system = 'on'` (set by the API only before anyone's business is known:
 *   signing in, emailed links) lets business rows be read, never written.
 * - `app.maintenance = 'on'` (backups, restores, data migrations: `SET LOCAL
 *   app.maintenance = 'on'` inside the migration) sees and writes everything.
 * - users: visible to a business only when it is their home business or they
 *   are its members (memberships), or before sign-in; anyone may be added.
 * - A new business table calls `select protect_business_table('name')` in its
 *   migration (tests/businessColumns.test.ts checks every table).
 */

const GLOBAL_AT_081 = [
  'kysely_migration',
  'kysely_migration_lock',
  'businesses',
  'tenants',
  'memberships',
  'users',
  'refresh_tokens',
  'account_tokens',
  'user_identities',
  'push_subscriptions',
  'email_outbox',
  'media',
  'invites',
  'passkeys',
];
const GLOBAL_LIST = sql.raw(`ARRAY[${GLOBAL_AT_081.map((name) => `'${name}'`).join(', ')}]`);

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '10s'`.execute(db);

  await sql`
    CREATE OR REPLACE FUNCTION current_business_id() RETURNS INT LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('app.business_id', true), '')::int
    $$
  `.execute(db);
  await sql`
    CREATE FUNCTION app_reads_all() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
      SELECT current_setting('app.system', true) = 'on'
    $$
  `.execute(db);
  await sql`
    CREATE FUNCTION app_maintenance() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
      SELECT current_setting('app.maintenance', true) = 'on'
    $$
  `.execute(db);
  await sql`
    CREATE FUNCTION protect_business_table(t TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
    BEGIN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
      EXECUTE format(
        'CREATE POLICY business_rows ON %I USING (business_id = (SELECT current_business_id()) OR (SELECT app_maintenance())) '
        'WITH CHECK (business_id = (SELECT current_business_id()) OR (SELECT app_maintenance()))', t);
      EXECUTE format('CREATE POLICY reads_before_sign_in ON %I FOR SELECT USING ((SELECT app_reads_all()))', t);
    END $$
  `.execute(db);

  await sql`
    DO $$
    DECLARE t TEXT;
    BEGIN
      FOR t IN
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'business_id' AND NOT a.attisdropped
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> ALL (${GLOBAL_LIST})
      LOOP
        PERFORM protect_business_table(t);
      END LOOP;
    END $$
  `.execute(db);

  await sql`ALTER TABLE users ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE users FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`
    CREATE POLICY members ON users
    USING (
      business_id = (SELECT current_business_id())
      OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.business_id = (SELECT current_business_id()))
      OR (SELECT app_reads_all()) OR (SELECT app_maintenance())
    )
    WITH CHECK (true)
  `.execute(db);

  // The view reads its tables as the person asking, so their business applies.
  await sql`ALTER VIEW sales_ledger SET (security_invoker = true)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER VIEW sales_ledger RESET (security_invoker)`.execute(db);
  await sql`DROP POLICY members ON users`.execute(db);
  await sql`ALTER TABLE users NO FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE users DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`
    DO $$
    DECLARE t TEXT;
    BEGIN
      FOR t IN
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND c.relname <> 'users'
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS business_rows ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS reads_before_sign_in ON %I', t);
        EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
      END LOOP;
    END $$
  `.execute(db);
  await sql`DROP FUNCTION protect_business_table(TEXT)`.execute(db);
  await sql`DROP FUNCTION app_maintenance()`.execute(db);
  await sql`DROP FUNCTION app_reads_all()`.execute(db);
  await sql`
    CREATE OR REPLACE FUNCTION current_business_id() RETURNS INT LANGUAGE sql STABLE AS $$
      SELECT COALESCE(NULLIF(current_setting('app.business_id', true), '')::int, (SELECT min(id) FROM businesses))
    $$
  `.execute(db);
}
