/**
 * Runs in each worker before each test file: points TEST_DATABASE_URL at this
 * worker's own database, so code that reads the variable directly lands there too.
 * setupTestApp makes that database a fresh copy of the template (testDatabases.ts).
 */
import { workerUrl } from './testDatabases.js';

process.env.TEST_DATABASE_URL = workerUrl();
