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
import * as alertSubjects from './011_alert_subjects.js';
import * as carwash from './012_carwash.js';
import * as cashCounts from './013_cash_counts.js';
import * as expenses from './014_expenses.js';
import * as customerTabs from './015_customer_tabs.js';
import * as purchaseOrders from './016_purchase_orders.js';
import * as expiryDates from './017_expiry_dates.js';
import * as barcodes from './018_barcodes.js';
import * as nui from './019_nui.js';
import * as carwashes from './020_carwashes.js';
import * as documents from './021_documents.js';

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
  '011_alert_subjects': alertSubjects,
  '012_carwash': carwash,
  '013_cash_counts': cashCounts,
  '014_expenses': expenses,
  '015_customer_tabs': customerTabs,
  '016_purchase_orders': purchaseOrders,
  '017_expiry_dates': expiryDates,
  '018_barcodes': barcodes,
  '019_nui': nui,
  '020_carwashes': carwashes,
  '021_documents': documents,
};
