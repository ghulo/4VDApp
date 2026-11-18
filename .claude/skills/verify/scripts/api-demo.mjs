// The API on port 3000, pointed at four_vd_app_demo. Started by preview_start
// "api-demo" (.claude/launch.json). Everything that talks to the outside world
// is switched off, and sign-ins use their own secret, so a demo session's
// cookie is worthless against the real database after the switch back.
import { spawn } from 'node:child_process';
import { DEMO_APP_ROLE, DEMO_DB, ROOT, databaseUrl } from './lib.mjs';

// Signs in as backend/.env's user but acts as DEMO_APP_ROLE from the first query on (demo-db.mjs makes and
// grants it), so row security keeps businesses apart as it does live.
const url = new URL(databaseUrl(DEMO_DB));
url.searchParams.set('options', `-c role=${DEMO_APP_ROLE}`);

const env = {
  ...process.env,
  DATABASE_URL: url.toString(),
  MIGRATION_DATABASE_URL: '',
  NODE_ENV: 'development',
  PORT: '3000',
  JWT_SECRET: 'verify-demo-only-secret-that-is-long-enough-to-pass',
  RESEND_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  GEMINI_API_KEY: '',
  VAPID_PUBLIC_KEY: '',
  VAPID_PRIVATE_KEY: '',
  SENTRY_DSN: '',
  GOOGLE_CLIENT_ID: '',
  BACKUP_PING_TOKEN: '',
  BILL_EMAIL_TOKEN: '',
};
console.log(`verify: API using database ${DEMO_DB} as role ${DEMO_APP_ROLE} (outbound email, push, AI and Sentry off)`);
// Not "tsx watch": one process, so preview_stop leaves nothing behind on Windows.
const child = spawn('npx', ['tsx', 'src/server.ts'], { cwd: `${ROOT}/backend`, env, stdio: 'inherit', shell: true });
const stop = () => child.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
