import { type Kysely, sql } from 'kysely';

/**
 * Many businesses, phase 5b: "developer" becomes 4VD's own staff, above every
 * business, and two ways round row security are closed.
 *
 * - `users.is_platform_developer`: set by hand on the live database, never by
 *   the app. A trigger refuses any change to it unless the database role is the
 *   one that owns the schema's functions (the migration role) or a superuser,
 *   so the app's own role (fourvd_app) can't flip it even with a bug.
 * - `developer` is no longer a role inside a business: the per-business top
 *   role is `main_admin` ("Main admin"). Existing developers get the flag and
 *   become Main admin of their business.
 * - `support_visits` / `support_actions`: when the 4VD developer opens a
 *   business he isn't a member of, the visit and each change he makes are kept
 *   there, for that business to see. Before/after are kept for a later undo.
 *   Rows can be added but not changed or removed by the app (only a visit's
 *   last_seen_at moves on, and an action gets its answer's status once).
 * - users: the 4VD developer's row is visible in a business he has visited (his name on
 *   what he did there); People lists show him only in his own business.
 * - `app.maintenance = 'on'` now counts only for the owner role or a superuser:
 *   the app's role setting it still sees just its own business.
 * - `app.system = 'on'` (before sign-in) now reads only the tables sign-in and
 *   the customers' portal read before the business is known; every other
 *   business table shows nothing in that mode.
 */

const ROLES = sql.raw(`('main_admin', 'admin', 'owner', 'employee', 'family', 'accountant')`);
const ROLES_BEFORE = sql.raw(`('developer', 'admin', 'owner', 'employee', 'family', 'accountant')`);

/** Read before anyone's business is known: the powers grid (settings) and the portal's sign-in. */
const READ_BEFORE_SIGN_IN = ['settings', 'customers', 'portal_users', 'portal_links', 'portal_sessions'];
const KEEP_LIST = sql.raw(`ARRAY[${READ_BEFORE_SIGN_IN.map((name) => `'${name}'`).join(', ')}]`);

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '10s'`.execute(db);

  // The owner of this function is the role migrations run as.
  await sql`
    CREATE FUNCTION app_is_owner() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
      SELECT EXISTS (
        SELECT 1 FROM pg_roles r
        WHERE r.rolname = current_user
          AND (r.rolsuper OR r.oid = (SELECT p.proowner FROM pg_proc p WHERE p.oid = 'public.app_is_owner()'::regprocedure))
      )
    $$
  `.execute(db);
  await sql`
    CREATE OR REPLACE FUNCTION app_maintenance() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
      SELECT current_setting('app.maintenance', true) = 'on' AND app_is_owner()
    $$
  `.execute(db);

  // The 4VD developer flag.
  await sql`ALTER TABLE users ADD COLUMN is_platform_developer BOOLEAN NOT NULL DEFAULT false`.execute(db);
  await sql`
    CREATE FUNCTION guard_platform_developer() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF (TG_OP = 'INSERT' AND NEW.is_platform_developer)
        OR (TG_OP = 'UPDATE' AND NEW.is_platform_developer IS DISTINCT FROM OLD.is_platform_developer) THEN
        IF NOT app_is_owner() THEN
          RAISE EXCEPTION 'The 4VD developer flag can only be set by hand on the database' USING ERRCODE = 'insufficient_privilege';
        END IF;
      END IF;
      RETURN NEW;
    END $$
  `.execute(db);
  await sql`
    CREATE TRIGGER users_guard_platform_developer
    BEFORE INSERT OR UPDATE OF is_platform_developer ON users
    FOR EACH ROW EXECUTE FUNCTION guard_platform_developer()
  `.execute(db);

  // developer → flag + Main admin. The users trigger copies the role to the home membership.
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`.execute(db);
  await sql`ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_role_check`.execute(db);
  await sql`SELECT set_config('app.maintenance', 'on', true)`.execute(db);
  await sql`UPDATE users SET is_platform_developer = true, role = 'main_admin', updated_at = now() WHERE role = 'developer'`.execute(db);
  await sql`UPDATE memberships SET role = 'main_admin' WHERE role = 'developer'`.execute(db);
  await sql`UPDATE invites SET role = 'main_admin' WHERE role = 'developer'`.execute(db);
  await sql`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ${ROLES})`.execute(db);
  await sql`ALTER TABLE invites ADD CONSTRAINT invites_role_check CHECK (role IN ${ROLES})`.execute(db);
  await sql`ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ${ROLES})`.execute(db);

  // Support visits, seen by the business.
  await sql`
    CREATE TABLE support_visits (
      id SERIAL PRIMARY KEY,
      business_id INT NOT NULL DEFAULT current_business_id() REFERENCES businesses(id),
      developer_id INT NOT NULL REFERENCES users(id),
      -- Kept here: the business can't read the developer's own user row.
      developer_name TEXT NOT NULL,
      session_id TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      reason TEXT,
      UNIQUE (business_id, developer_id, session_id)
    )
  `.execute(db);
  await sql`CREATE INDEX support_visits_newest ON support_visits (business_id, started_at DESC)`.execute(db);
  await sql`
    CREATE TABLE support_actions (
      id SERIAL PRIMARY KEY,
      business_id INT NOT NULL DEFAULT current_business_id() REFERENCES businesses(id),
      visit_id INT NOT NULL REFERENCES support_visits(id),
      at TIMESTAMPTZ NOT NULL DEFAULT now(),
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      status INT,
      before JSONB,
      after JSONB
    )
  `.execute(db);
  await sql`CREATE INDEX support_actions_by_visit ON support_actions (visit_id, at)`.execute(db);
  await sql`
    CREATE FUNCTION keep_support_log() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF app_is_owner() THEN
        RETURN COALESCE(NEW, OLD);
      END IF;
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Support visits are kept' USING ERRCODE = 'insufficient_privilege';
      END IF;
      -- Only a visit's last_seen_at moves on, and an action gets its answer's status once.
      IF TG_TABLE_NAME = 'support_visits' THEN
        IF to_jsonb(NEW) - 'last_seen_at' = to_jsonb(OLD) - 'last_seen_at' THEN
          RETURN NEW;
        END IF;
      ELSIF to_jsonb(OLD) ->> 'status' IS NULL AND to_jsonb(NEW) - 'status' = to_jsonb(OLD) - 'status' THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Support visits are kept' USING ERRCODE = 'insufficient_privilege';
    END $$
  `.execute(db);
  await sql`CREATE TRIGGER support_visits_kept BEFORE UPDATE OR DELETE ON support_visits FOR EACH ROW EXECUTE FUNCTION keep_support_log()`.execute(db);
  await sql`CREATE TRIGGER support_actions_kept BEFORE UPDATE OR DELETE ON support_actions FOR EACH ROW EXECUTE FUNCTION keep_support_log()`.execute(db);

  // The developer's own row shows in a business once he has visited it (his name on what he did there).
  await sql`DROP POLICY members ON users`.execute(db);
  await sql`
    CREATE POLICY members ON users
    USING (
      business_id = (SELECT current_business_id())
      OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.business_id = (SELECT current_business_id()))
      OR (SELECT app_reads_all()) OR (SELECT app_maintenance())
      OR (is_platform_developer AND EXISTS (SELECT 1 FROM support_visits v WHERE v.developer_id = users.id AND v.business_id = (SELECT current_business_id())))
    )
    WITH CHECK (true)
  `.execute(db);

  // New business tables no longer get the before-sign-in read policy.
  await sql`
    CREATE OR REPLACE FUNCTION protect_business_table(t TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
    BEGIN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
      EXECUTE format(
        'CREATE POLICY business_rows ON %I USING (business_id = (SELECT current_business_id()) OR (SELECT app_maintenance())) '
        'WITH CHECK (business_id = (SELECT current_business_id()) OR (SELECT app_maintenance()))', t);
    END $$
  `.execute(db);
  await sql`SELECT protect_business_table('support_visits')`.execute(db);
  await sql`SELECT protect_business_table('support_actions')`.execute(db);
  await sql`
    DO $$
    DECLARE t TEXT;
    BEGIN
      FOR t IN
        SELECT tablename FROM pg_policies
        WHERE schemaname = 'public' AND policyname = 'reads_before_sign_in' AND tablename <> ALL (${KEEP_LIST})
      LOOP
        EXECUTE format('DROP POLICY reads_before_sign_in ON %I', t);
      END LOOP;
    END $$
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DO $$
    DECLARE t TEXT;
    BEGIN
      FOR t IN
        SELECT tablename FROM pg_policies
        WHERE schemaname = 'public' AND policyname = 'business_rows'
          AND tablename NOT IN (SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'reads_before_sign_in')
          AND tablename NOT IN ('support_visits', 'support_actions')
      LOOP
        EXECUTE format('CREATE POLICY reads_before_sign_in ON %I FOR SELECT USING ((SELECT app_reads_all()))', t);
      END LOOP;
    END $$
  `.execute(db);
  await sql`
    CREATE OR REPLACE FUNCTION protect_business_table(t TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
    BEGIN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
      EXECUTE format(
        'CREATE POLICY business_rows ON %I USING (business_id = (SELECT current_business_id()) OR (SELECT app_maintenance())) '
        'WITH CHECK (business_id = (SELECT current_business_id()) OR (SELECT app_maintenance()))', t);
      EXECUTE format('CREATE POLICY reads_before_sign_in ON %I FOR SELECT USING ((SELECT app_reads_all()))', t);
    END $$
  `.execute(db);
  await sql`DROP POLICY members ON users`.execute(db);
  await sql`
    CREATE POLICY members ON users
    USING (
      business_id = (SELECT current_business_id())
      OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.business_id = (SELECT current_business_id()))
      OR (SELECT app_reads_all()) OR (SELECT app_maintenance())
    )
    WITH CHECK (true)
  `.execute(db);
  await sql`DROP TABLE support_actions`.execute(db);
  await sql`DROP TABLE support_visits`.execute(db);
  await sql`DROP FUNCTION keep_support_log()`.execute(db);

  await sql`ALTER TABLE memberships DROP CONSTRAINT memberships_role_check`.execute(db);
  await sql`ALTER TABLE users DROP CONSTRAINT users_role_check`.execute(db);
  await sql`ALTER TABLE invites DROP CONSTRAINT invites_role_check`.execute(db);
  await sql`SELECT set_config('app.maintenance', 'on', true)`.execute(db);
  await sql`UPDATE users SET role = 'developer', updated_at = now() WHERE is_platform_developer`.execute(db);
  await sql`UPDATE memberships SET role = 'developer' WHERE role = 'main_admin' AND user_id IN (SELECT id FROM users WHERE is_platform_developer)`.execute(db);
  await sql`UPDATE memberships SET role = 'admin' WHERE role = 'main_admin'`.execute(db);
  await sql`UPDATE users SET role = 'admin', updated_at = now() WHERE role = 'main_admin'`.execute(db);
  await sql`UPDATE invites SET role = 'admin' WHERE role = 'main_admin'`.execute(db);
  await sql`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ${ROLES_BEFORE})`.execute(db);
  await sql`ALTER TABLE invites ADD CONSTRAINT invites_role_check CHECK (role IN ${ROLES_BEFORE})`.execute(db);
  await sql`DROP TRIGGER users_guard_platform_developer ON users`.execute(db);
  await sql`DROP FUNCTION guard_platform_developer()`.execute(db);
  await sql`ALTER TABLE users DROP COLUMN is_platform_developer`.execute(db);

  await sql`
    CREATE OR REPLACE FUNCTION app_maintenance() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
      SELECT current_setting('app.maintenance', true) = 'on'
    $$
  `.execute(db);
  await sql`DROP FUNCTION app_is_owner()`.execute(db);
}
