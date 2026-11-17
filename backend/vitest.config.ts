import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Files run side by side, each worker on its own copy of a database migrated once per run (tests/helpers/testDatabases.ts).
    // Four is where a laptop's Postgres stops getting faster; VITEST_MAX_WORKERS overrides it.
    globalSetup: ['tests/helpers/globalSetup.ts'],
    setupFiles: ['tests/helpers/workerDatabase.ts'],
    fileParallelism: true,
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS) || Math.min(4, availableParallelism()),
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
