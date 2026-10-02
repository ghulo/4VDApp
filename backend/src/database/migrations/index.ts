import type { Migration } from 'kysely/migration';
import * as initialSchema from './001_initial_schema.js';
import * as reportsAndActivity from './002_reports_and_activity.js';
import * as returnsCountsWriteOffs from './003_returns_counts_write_offs.js';
import * as promotionsAndTargets from './004_promotions_and_targets.js';

/**
 * Every migration, keyed by name. Kysely runs them in key order, so always
 * prefix new ones with the next number. Listing them here (instead of reading
 * the folder at runtime) works the same under tsx, the compiled build and
 * Windows paths.
 */
export const migrations: Record<string, Migration> = {
  '001_initial_schema': initialSchema,
  '002_reports_and_activity': reportsAndActivity,
  '003_returns_counts_write_offs': returnsCountsWriteOffs,
  '004_promotions_and_targets': promotionsAndTargets,
};
