import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createContainer } from './container.js';
import { createDatabase } from './database/connection.js';
import { logger } from './utils/logger.js';

const config = loadConfig();
const db = createDatabase(config.databaseUrl);
const container = createContainer(config, db);
const app = createApp(config, db, { container });

/** How often new notifications are pushed to phones and browsers. */
const PUSH_INTERVAL_MS = 5_000;
let isPushing = false;
const pushTimer = setInterval(() => {
  // Skip a beat rather than overlap if sending is slow.
  if (isPushing) return;
  isPushing = true;
  container.pushService
    .sendPending()
    .catch((error) => logger.error('Sending push alerts failed', { error: String(error) }))
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
  server.close(() => {
    db.destroy().finally(() => process.exit(0));
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
