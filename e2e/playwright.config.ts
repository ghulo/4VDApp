import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the money paths. They start their own API and dashboard
 * on their own ports and their own database (four_vd_app_e2e, wiped at the
 * start of every run), so the shop's database and the local servers on
 * 3000/5173 are never touched. On GitHub they run in the "Browser tests" job.
 */

const API_PORT = 3100;
const WEB_PORT = 5180;
export const API_URL = `http://localhost:${API_PORT}`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;

/** The e2e database: given by CI, or the local one with its name swapped. */
function databaseUrl(): string {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const env = readFileSync(new URL('../backend/.env', import.meta.url), 'utf8');
  const local = /^DATABASE_URL=(.+)$/m.exec(env)?.[1]?.trim();
  if (!local) throw new Error('Set E2E_DATABASE_URL, or DATABASE_URL in backend/.env');
  const url = new URL(local);
  url.pathname = '/four_vd_app_e2e';
  return url.toString();
}

// Everything the API needs, set here so backend/.env's real keys (email, AI, push) are never used.
const apiEnv = {
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  DATABASE_URL: databaseUrl(),
  JWT_SECRET: 'e2e-only-secret-that-is-long-enough-to-pass',
  CORS_ORIGINS: WEB_URL,
  DASHBOARD_URL: WEB_URL,
  SHOP_TIME_ZONE: 'Europe/Belgrade',
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

export default defineConfig({
  testDir: './tests',
  // The flows share one database and build on each other's stock: one at a time.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-GB',
    timezoneId: 'Europe/Belgrade',
  },
  projects: [
    { name: 'setup', testMatch: /setup\.ts$/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testIgnore: /setup\.ts$/,
    },
  ],
  webServer: [
    {
      // Fresh database first, then the API.
      command: 'npx tsx src/scripts/prepareE2e.ts && npx tsx src/server.ts',
      cwd: '../backend',
      url: `${API_URL}/health`,
      env: apiEnv,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      cwd: '../admin',
      url: WEB_URL,
      env: { VITE_API_URL: API_URL },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
