import { sql } from 'kysely';
import type { DatabaseClient } from './connection.js';

export interface DatabaseRole {
  name: string;
  superuser: boolean;
  bypassesRowSecurity: boolean;
}

/** Which database role the app connects as, and whether row security can be skipped by it. */
export async function databaseRole(db: DatabaseClient): Promise<DatabaseRole> {
  const { rows } = await sql<{ name: string; superuser: boolean; bypass: boolean }>`
    SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user
  `.execute(db);
  const row = rows[0]!;
  return { name: row.name, superuser: row.superuser, bypassesRowSecurity: row.bypass };
}

/**
 * Live, the app must never run as a role that skips row security (a superuser
 * or BYPASSRLS): then one business's request could read another's rows.
 * Returns why not to start, or null.
 */
export function refuseRole(role: DatabaseRole, nodeEnv: string): string | null {
  if (nodeEnv !== 'production') return null;
  if (role.superuser) return `The database role ${role.name} is a superuser, which skips row security`;
  if (role.bypassesRowSecurity) return `The database role ${role.name} has BYPASSRLS, which skips row security`;
  return null;
}
