import { type Kysely, sql } from 'kysely';

/**
 * Two new roles: "developer" (the person who runs and builds 4VD: everything,
 * and the only one who hands out the top roles) and "owner" (sees the whole
 * business and decides requests, but doesn't change products, people or
 * settings). The first admin ever created becomes the developer.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const roles = sql.raw(`('developer', 'admin', 'owner', 'employee', 'family')`);
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`.execute(db);
  await sql`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ${roles})`.execute(db);
  await sql`ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_role_check`.execute(db);
  await sql`ALTER TABLE invites ADD CONSTRAINT invites_role_check CHECK (role IN ${roles})`.execute(db);
  await sql`
    UPDATE users SET role = 'developer', updated_at = now()
    WHERE id = (
      SELECT id FROM users
      WHERE role = 'admin' AND is_active AND deleted_at IS NULL
      ORDER BY created_at, id
      LIMIT 1
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`UPDATE users SET role = 'admin' WHERE role IN ('developer', 'owner')`.execute(db);
  await sql`UPDATE invites SET role = 'admin' WHERE role IN ('developer', 'owner')`.execute(db);
  const roles = sql.raw(`('admin', 'employee', 'family')`);
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`.execute(db);
  await sql`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ${roles})`.execute(db);
  await sql`ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_role_check`.execute(db);
  await sql`ALTER TABLE invites ADD CONSTRAINT invites_role_check CHECK (role IN ${roles})`.execute(db);
}
