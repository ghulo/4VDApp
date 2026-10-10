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
/** The reports check once a minute whether someone's hour has come. */
const SUMMARY_CHECK_MS = 60_000;
/** After a shutdown signal, stop waiting for open connections after this long. */
const SHUTDOWN_GRACE_MS = 10_000;
let isChecking = false;
const summaryTimer = setInterval(() => {
  // Skip a beat rather than overlap if a run is slow, so nothing is sent twice.
  if (isChecking) return;
  isChecking = true;
  const report = container.reportDeliveryService
    .sendDue()
    .catch((error) => logger.error('Sending the reports failed', { error: String(error) }));
  const expenses = container.expenseService
    .fillDue()
    .catch((error) => logger.error('Adding the monthly expenses failed', { error: String(error) }));
  const alert = container.errorAlertService
    .sendIfDue()
    // Logged as a warning on purpose: as an error it would be counted again and retried forever.
    .catch((error) => logger.warn('Sending the error alert failed', { error: String(error) }));
  Promise.all([report, expenses, alert]).finally(() => {
    isChecking = false;
  });
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
function shutdown(signal: string, exitCode = 0): void {
  logger.info('Shutting down', { signal });
  clearInterval(pushTimer);
  clearInterval(summaryTimer);
  server.close(() => {
    db.destroy().finally(() => process.exit(exitCode));
  });
  // Idle keep-alive connections would hold close() open; busy ones get a grace period.
  server.closeIdleConnections();
  setTimeout(() => process.exit(exitCode), SHUTDOWN_GRACE_MS).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// A bug nobody caught: log it (which queues the developer alert), try to send that
// alert now since it only lives in memory, then restart clean. Render starts us again.
let crashing = false;
function crash(kind: string, error: unknown): void {
  if (crashing) return;
  crashing = true;
  logger.error(kind, { error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
  container.errorAlertService
    .sendIfDue()
    .then(() => container.emailService.sendPending())
    .catch(() => undefined)
    .finally(() => shutdown(kind, 1));
}

process.on('unhandledRejection', (reason) => crash('Unhandled promise rejection', reason));
process.on('uncaughtException', (error) => crash('Uncaught exception', error));
