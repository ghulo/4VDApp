import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createContainer } from './container.js';
import { ensureFirstAdmin } from './database/firstAdmin.js';
import { createDatabase } from './database/connection.js';
import { logger } from './utils/logger.js';

const config = loadConfig();
const db = createDatabase(config.databaseUrl);
const container = createContainer(config, db);
await ensureFirstAdmin(db, {
  email: process.env.SEED_ADMIN_EMAIL,
  password: process.env.SEED_ADMIN_PASSWORD,
  name: process.env.SEED_ADMIN_NAME,
});
const app = createApp(config, db, { container });
// Every error logged from here on reaches the developer by email (at most hourly).
logger.onError((message, context) => container.errorAlertService.record(message, context));

/** How often new notifications are pushed to phones and browsers, and queued emails sent. */
const PUSH_INTERVAL_MS = 5_000;
let isPushing = false;
/** The daily summary checks once a minute whether its hour has come. */
const SUMMARY_CHECK_MS = 60_000;
const summaryTimer = setInterval(() => {
  container.dailySummaryService
    .sendIfDue()
    .catch((error) => logger.error('Sending the daily summary failed', { error: String(error) }));
  container.weeklyReportService
    .sendIfDue()
    .catch((error) => logger.error('Sending the weekly report failed', { error: String(error) }));
  container.errorAlertService
    .sendIfDue()
    // Logged as a warning on purpose: as an error it would be counted again and retried forever.
    .catch((error) => logger.warn('Sending the error alert failed', { error: String(error) }));
}, SUMMARY_CHECK_MS);

const pushTimer = setInterval(() => {
  // Skip a beat rather than overlap if sending is slow.
  if (isPushing) return;
  isPushing = true;
  Promise.all([
    container.pushService
      .sendPending()
      .catch((error) => logger.error('Sending push alerts failed', { error: String(error) })),
    container.emailService
      .sendPending()
      .catch((error) => logger.error('Sending emails failed', { error: String(error) })),
  ])
    .finally(() => {
      isPushing = false;
    });
}, PUSH_INTERVAL_MS);

const server = app.listen(config.port, () => {
  logger.info('4VD App API started', { port: config.port, env: config.nodeEnv });
});

// Let in-flight requests finish before the host (Render, Docker) kills us,
// then close the database pool.
function shutdown(signal: string): void {
  logger.info('Shutting down', { signal });
  clearInterval(pushTimer);
  clearInterval(summaryTimer);
  server.close(() => {
    db.destroy().finally(() => process.exit(0));
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
