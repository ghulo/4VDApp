import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createContainer } from './container.js';
import { defaultBusinessId } from './database/business.js';
import { runAsBusiness } from './database/businessContext.js';
import { ensureFirstAdmin } from './database/firstAdmin.js';
import { createDatabase } from './database/connection.js';
import { databaseRole, refuseRole } from './database/roleCheck.js';
import { captureError, captureLoggedError, flushErrorTracking, initErrorTracking } from './utils/errorTracking.js';
import { minuteJobs, pushJobs } from './timers.js';
import { logger } from './utils/logger.js';

const config = loadConfig();
initErrorTracking(config.sentryDsn, config.nodeEnv);
const db = createDatabase(config.databaseUrl);
const role = await databaseRole(db);
const refused = refuseRole(role, config.nodeEnv);
if (refused) {
  logger.error(`Refusing to start: ${refused}. Point DATABASE_URL at the app's own role (docs/DEPLOYMENT.md).`);
  await flushErrorTracking();
  process.exit(1);
}
logger.info('Connected to the database', { role: role.name });
const container = createContainer(config, db);
await runAsBusiness(await defaultBusinessId(db), () =>
  ensureFirstAdmin(db, {
    email: process.env.SEED_ADMIN_EMAIL,
    password: process.env.SEED_ADMIN_PASSWORD,
    name: process.env.SEED_ADMIN_NAME,
  }),
);
const app = createApp(config, db, { container });
// Every error logged from here on reaches the developer by email (at most hourly), and Sentry when it is set up.
logger.onError((message, context) => {
  container.errorAlertService.record(message, context);
  captureLoggedError(message, context);
});

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
  minuteJobs(db, container).finally(() => {
    isChecking = false;
  });
}, SUMMARY_CHECK_MS);

const pushTimer = setInterval(() => {
  // Skip a beat rather than overlap if sending is slow.
  if (isPushing) return;
  isPushing = true;
  pushJobs(db, container)
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
  captureError(error, { kind });
  // Like the minute timer: the alert remembers its hour in the 4VD shop's settings, so it runs inside that business.
  const alert = defaultBusinessId(db).then((shop) => runAsBusiness(shop, () => container.errorAlertService.sendIfDue()));
  Promise.all([flushErrorTracking(), alert])
    .then(() => container.emailService.sendPending())
    .catch(() => undefined)
    .finally(() => shutdown(kind, 1));
}

process.on('unhandledRejection', (reason) => crash('Unhandled promise rejection', reason));
process.on('uncaughtException', (error) => crash('Uncaught exception', error));
