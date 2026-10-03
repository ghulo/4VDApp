import type { Migration } from 'kysely/migration';
import * as initialSchema from './001_initial_schema.js';
import * as reportsAndActivity from './002_reports_and_activity.js';
import * as returnsCountsWriteOffs from './003_returns_counts_write_offs.js';
import * as promotionsAndTargets from './004_promotions_and_targets.js';
import * as pushNotifications from './005_push_notifications.js';
import * as accounts from './006_accounts.js';
import * as weeklyReport from './007_weekly_report.js';
import * as roles from './008_roles.js';
import * as language from './009_language.js';
import * as undo from './010_undo.js';

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
  '005_push_notifications': pushNotifications,
  '006_accounts': accounts,
  '007_weekly_report': weeklyReport,
  '008_roles': roles,
  '009_language': language,
  '010_undo': undo,
};
