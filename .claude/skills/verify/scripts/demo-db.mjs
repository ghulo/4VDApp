// Makes sure four_vd_app_demo exists, is migrated, holds the demo data and
// the marker category. Safe to run any number of times.
//   node .claude/skills/verify/scripts/demo-db.mjs [--reseed]
// --reseed drops and rebuilds the demo database from scratch.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEMO_DB, MARKER, ROOT, databaseUrl, requireBackend } from './lib.mjs';

const pg = requireBackend('pg');
const demoUrl = databaseUrl(DEMO_DB);
if (new URL(demoUrl).pathname !== `/${DEMO_DB}`) throw new Error('refusing: not the demo database');
const started = Date.now();
const say = (line) => console.log(`demo-db: ${line}`);

async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// 1. Create (or rebuild) the database.
const adminUrl = databaseUrl('postgres');
await withClient(adminUrl, async (client) => {
  if (process.argv.includes('--reseed')) {
    await client.query(`DROP DATABASE IF EXISTS ${DEMO_DB} WITH (FORCE)`);
    say('dropped for --reseed');
  }
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DEMO_DB]);
  if (!rowCount) {
    await client.query(`CREATE DATABASE ${DEMO_DB}`);
    say('created');
  }
});

// 2. Every script below runs against the demo database only, asserted first.
await withClient(demoUrl, async (client) => {
  const { rows } = await client.query('SELECT current_database() AS name');
  if (rows[0].name !== DEMO_DB) throw new Error(`refusing: connected to ${rows[0].name}`);
});
const env = { ...process.env, DATABASE_URL: demoUrl, MIGRATION_DATABASE_URL: demoUrl, NODE_ENV: 'development' };
const run = (script) =>
  execFileSync('npm', ['--prefix', 'backend', 'run', '--silent', script], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], shell: true });

try {
  run('migrate');
} catch (error) {
  console.error(`demo-db: FAIL migrate: ${String(error.stderr || error.stdout || error.message).slice(-800)}`);
  process.exit(1);
}
say('migrated');

// 3. Seed by content: the demo logins and some sales must be there.
const state = await withClient(demoUrl, async (client) => {
  const users = await client.query("SELECT count(*)::int AS n FROM users WHERE email LIKE 'demo-%@4vd.local'");
  const sales = await client.query('SELECT count(*)::int AS n FROM sales');
  return { users: users.rows[0].n, sales: sales.rows[0].n };
});
if (state.users < 4 || state.sales === 0) {
  try {
    run('seed:demo');
  } catch (error) {
    console.error(`demo-db: FAIL seed:demo: ${String(error.stderr || error.stdout || error.message).slice(-800)}`);
    process.exit(1);
  }
  say('seeded (demo logins, products, a month of sales)');
}

// 4. The marker category, in the shop's (first) business.
await withClient(demoUrl, async (client) => {
  await client.query(
    `INSERT INTO categories (name, description, business_id)
     SELECT $1::varchar, 'Only in four_vd_app_demo: verify reads it to know which database port 3000 serves.', (SELECT min(id) FROM businesses)
     WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = $1::varchar AND deleted_at IS NULL)`,
    [MARKER],
  );
});

// 5. The api-demo entry in .claude/launch.json (that file is local, not in git).
const launchPath = path.join(ROOT, '.claude', 'launch.json');
if (existsSync(launchPath)) {
  const launch = JSON.parse(readFileSync(launchPath, 'utf8'));
  if (!launch.configurations.some((c) => c.name === 'api-demo')) {
    launch.configurations.push({
      name: 'api-demo',
      runtimeExecutable: 'node',
      runtimeArgs: ['.claude/skills/verify/scripts/api-demo.mjs'],
      port: 3000,
    });
    writeFileSync(launchPath, `${JSON.stringify(launch, null, 2)}\n`);
    say('added api-demo to .claude/launch.json');
  }
}
say(`ready in ${((Date.now() - started) / 1000).toFixed(1)}s`);
