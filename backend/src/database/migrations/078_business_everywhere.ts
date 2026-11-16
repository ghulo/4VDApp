import { type Kysely, sql } from 'kysely';

/**
 * Many businesses, phase 1: every row says which business it belongs to.
 * Purely additive: nothing reads these columns yet, so the running app is unchanged.
 *
 * - `tenants`: who pays for 4VD. A tenant has one or more businesses
 *   (the Dacaj family is one tenant). Named "tenant", not "account", so it
 *   isn't confused with ledger accounts.
 * - `memberships`: who works for which business, and as what. Until sign-in
 *   reads it (phase 3), `users.role` / `users.business_id` stay the truth and a
 *   trigger copies them here.
 * - `current_business_id()`: the business of the current request, from the
 *   `app.business_id` setting. Until phase 3 sets it, it falls back to the
 *   first business. Phase 4 removes the fallback, or a request without a
 *   business would write into the first shop.
 * - `business_id` on every table except the ones read before anyone's business
 *   is known or that describe the person rather than a business:
 *   businesses, tenants, memberships (has its own), users, refresh_tokens,
 *   account_tokens, user_identities, push_subscriptions, email_outbox (sent by
 *   the server for everyone), media and invites (already have one), and
 *   Kysely's own migration tables.
 *
 * The column is added with a constant default (no table rewrite, instant on
 * big tables), then switched to `current_business_id()`. No foreign key to
 * businesses yet: tests empty `businesses` with TRUNCATE … CASCADE, which would
 * then empty every table, migration-seeded ones included.
 */

export const GLOBAL_TABLES = [
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
];

// Inlined: a DO block can't take parameters. The names are constants above.
const GLOBAL_LIST = sql.raw(`ARRAY[${GLOBAL_TABLES.map((name) => `'${name}'`).join(', ')}]`);

export async function up(db: Kysely<unknown>): Promise<void> {
  // A busy shop should make this fail fast and retry on the next start, not freeze the Counter.
  await sql`SET LOCAL lock_timeout = '10s'`.execute(db);

  // All data so far belongs to the one shop. If stray businesses exist (sign-ups), the shop is the one with most people.
  const existing = await sql<{ id: number }>`
    SELECT b.id FROM businesses b
    ORDER BY (SELECT count(*) FROM users u WHERE u.business_id = b.id) DESC, b.id
    LIMIT 1
  `.execute(db);
  const shopId =
    existing.rows[0]?.id ??
    (await sql<{ id: number }>`INSERT INTO businesses (name) VALUES ('4VD') RETURNING id`.execute(db)).rows[0]!.id;

  await sql`
    CREATE TABLE tenants (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`ALTER TABLE businesses ADD COLUMN tenant_id INT REFERENCES tenants(id)`.execute(db);
  await sql`
    WITH made AS (
      INSERT INTO tenants (name) SELECT name FROM businesses WHERE id = ${shopId} RETURNING id
    )
    UPDATE businesses SET tenant_id = (SELECT id FROM made)
  `.execute(db);

  await sql`
    CREATE TABLE memberships (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      business_id INT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, business_id)
    )
  `.execute(db);
  await sql`CREATE INDEX memberships_business ON memberships (business_id)`.execute(db);
  await sql`
    INSERT INTO memberships (user_id, business_id, role, is_active)
    SELECT id, COALESCE(business_id, ${shopId}), role, is_active FROM users
  `.execute(db);
  await sql`
    CREATE FUNCTION copy_user_to_membership() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.business_id IS NOT NULL THEN
        INSERT INTO memberships (user_id, business_id, role, is_active)
        VALUES (NEW.id, NEW.business_id, NEW.role, NEW.is_active)
        ON CONFLICT (user_id, business_id) DO UPDATE SET role = EXCLUDED.role, is_active = EXCLUDED.is_active;
      END IF;
      RETURN NEW;
    END $$
  `.execute(db);
  await sql`
    CREATE TRIGGER users_copy_to_membership
    AFTER INSERT OR UPDATE OF role, business_id, is_active ON users
    FOR EACH ROW EXECUTE FUNCTION copy_user_to_membership()
  `.execute(db);

  await sql`
    CREATE FUNCTION current_business_id() RETURNS INT LANGUAGE sql STABLE AS $$
      SELECT COALESCE(NULLIF(current_setting('app.business_id', true), '')::int, (SELECT min(id) FROM businesses))
    $$
  `.execute(db);

  await sql`
    DO $$
    DECLARE t TEXT;
    BEGIN
      FOR t IN
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relname <> ALL (${GLOBAL_LIST})
          AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'business_id' AND NOT a.attisdropped)
      LOOP
        EXECUTE format('ALTER TABLE %I ADD COLUMN business_id INT NOT NULL DEFAULT %s', t, ${sql.lit(shopId)});
        EXECUTE format('ALTER TABLE %I ALTER COLUMN business_id SET DEFAULT current_business_id()', t);
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
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'business_id' AND NOT a.attisdropped
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relname <> ALL (${GLOBAL_LIST})
      LOOP
        EXECUTE format('ALTER TABLE %I DROP COLUMN business_id', t);
      END LOOP;
    END $$
  `.execute(db);
  await sql`DROP FUNCTION current_business_id()`.execute(db);
  await sql`DROP TRIGGER users_copy_to_membership ON users`.execute(db);
  await sql`DROP FUNCTION copy_user_to_membership()`.execute(db);
  await sql`DROP TABLE memberships`.execute(db);
  await sql`ALTER TABLE businesses DROP COLUMN tenant_id`.execute(db);
  await sql`DROP TABLE tenants`.execute(db);
}
