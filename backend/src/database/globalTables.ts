/**
 * Tables without a business_id: read before anyone's business is known, or
 * describing the person rather than a business. Every other table must have
 * `business_id INT NOT NULL DEFAULT current_business_id()` (tests/businessColumns.test.ts).
 * Add a new global table here, with the reason.
 */
export const GLOBAL_TABLES: readonly string[] = [
  'kysely_migration',
  'kysely_migration_lock',
  'businesses',
  'tenants',
  'memberships', // has its own business_id: one row per person and business
  'users',
  'refresh_tokens',
  'account_tokens',
  'user_identities',
  'passkeys', // a person's own devices, used before their business is known
  'push_subscriptions',
  'email_outbox', // sent by the server for everyone
  'media', // nullable business_id: people's photos have none
  'invites', // has business_id, but is opened by link before sign-in
  'all_logs_reads', // the 4VD developer reading All logs, across businesses
];
