import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { logger } from './utils/logger.js';

const config = loadConfig();
const app = createApp(config);

const server = app.listen(config.port, () => {
  logger.info('4VD App API started', { port: config.port, env: config.nodeEnv });
});

// Let in-flight requests finish before the host (Render, Docker) kills us.
function shutdown(signal: string): void {
  logger.info('Shutting down', { signal });
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
