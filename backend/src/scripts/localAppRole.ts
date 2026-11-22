/**
 * Local only: make the limited role the local API acts as (DATABASE_ROLE in backend/.env), so row security keeps
 * businesses apart on this PC as it does live. Run once per database, and again after a new database is made:
 *
 *   npm run db:local-role                          -> four_vd_app
 *   npm run db:local-role -- four_vd_app_demo      -> any other local database
 *
 * The role can't sign in (NOLOGIN): the API signs in as DATABASE_URL's user and switches to it (SET ROLE). It is no
 * superuser and has no BYPASSRLS, so it sees only its own business's rows. Tables that later migrations add (run as
 * DATABASE_URL's user) are granted to it by default. Steps in docs/DEPLOYMENT.md, "Local API as a limited role".
 */
import 'dotenv/config';
import pg from 'pg';

export const LOCAL_APP_ROLE = 'fourvd_app_local';

async function grant(baseUrl: string, database: string): Promise<void> {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  url.search = '';
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${LOCAL_APP_ROLE}') THEN
          CREATE ROLE ${LOCAL_APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        END IF;
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END $$`);
    // The user the API signs in as must be allowed to switch to it (a superuser always is).
    await client.query(`GRANT ${LOCAL_APP_ROLE} TO CURRENT_USER`);
    await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${LOCAL_APP_ROLE}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${LOCAL_APP_ROLE}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${LOCAL_APP_ROLE}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${LOCAL_APP_ROLE}`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${LOCAL_APP_ROLE}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${LOCAL_APP_ROLE}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${LOCAL_APP_ROLE}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${LOCAL_APP_ROLE}`);
    const { rows } = await client.query<{ super: boolean; bypass: boolean }>(`SELECT rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname = $1`, [LOCAL_APP_ROLE]);
    if (rows[0]?.super || rows[0]?.bypass) throw new Error(`${LOCAL_APP_ROLE} skips row security: drop it and run this again`);
    console.log(`${database}: ${LOCAL_APP_ROLE} granted (row security applies to it). Put DATABASE_ROLE=${LOCAL_APP_ROLE} in backend/.env for the API.`);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Local only: live has its own role (docs/DEPLOYMENT.md)');
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is missing (backend/.env)');
  const names = process.argv.slice(2).filter((arg) => arg !== '--');
  for (const name of names.length ? names : [new URL(base).pathname.slice(1)]) {
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Not a database name: ${name}`);
    await grant(base, name);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
