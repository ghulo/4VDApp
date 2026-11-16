import { type Kysely, sql } from 'kysely';

/**
 * Many businesses, phase 2: what must be unique is unique within one business.
 * Two shops may both have invoice 2026-0001, barcode 3800…, a "Drinks" category
 * or a VAT month 2026-10.
 *
 * Keys that hang off a parent row (a product's tiers, a count's lines, a
 * supplier's codes…) stay as they are: the parent already belongs to one
 * business. Random tokens and people's emails stay unique everywhere.
 *
 * Built in the deploy's transaction, not CONCURRENTLY: the biggest table
 * (documents, about 125k rows after the TREFIN import) indexes in well under a
 * second, and a failed half-run would leave the old keys in place.
 */

interface Key {
  table: string;
  /** The old constraint or index. */
  old: string;
  /** Its new name and columns (business_id first), with any WHERE. */
  name: string;
  columns: string;
  where?: string;
  primary?: boolean;
  /** Old definition, for down. */
  was: string;
}

const KEYS: Key[] = [
  { table: 'bill_emails', old: 'bill_emails_message_id_file_hash_key', name: 'bill_emails_message_file_key', columns: 'business_id, message_id, file_hash', was: '(message_id, file_hash)' },
  { table: 'book_years', old: 'book_years_pkey', name: 'book_years_pkey', columns: 'business_id, year', primary: true, was: '(year)' },
  { table: 'carwashes', old: 'carwashes_open_name_idx', name: 'carwashes_open_name_idx', columns: 'business_id, lower(name)', where: 'archived_at IS NULL', was: '(lower(name)) WHERE archived_at IS NULL' },
  { table: 'cash_counts', old: 'cash_counts_drawer_day_key', name: 'cash_counts_drawer_day_key', columns: 'business_id, place, carwash_id, day', was: '(place, carwash_id, day)' },
  { table: 'cash_openings', old: 'cash_openings_drawer_day_key', name: 'cash_openings_drawer_day_key', columns: 'business_id, place, carwash_id, day', was: '(place, carwash_id, day)' },
  { table: 'categories', old: 'idx_categories_name_active', name: 'idx_categories_name_active', columns: 'business_id, lower(name)', where: 'deleted_at IS NULL', was: '(lower(name)) WHERE deleted_at IS NULL' },
  { table: 'day_closings', old: 'day_closings_pkey', name: 'day_closings_pkey', columns: 'business_id, day', primary: true, was: '(day)' },
  { table: 'depreciation_months', old: 'depreciation_months_month_key', name: 'depreciation_months_month_key', columns: 'business_id, month', was: '(month)' },
  { table: 'document_numbers', old: 'document_numbers_pkey', name: 'document_numbers_pkey', columns: 'business_id, kind, year', primary: true, was: '(kind, year)' },
  { table: 'document_threads', old: 'document_threads_subject_key', name: 'document_threads_subject_key', columns: 'business_id, subject', was: '(subject)' },
  { table: 'documents', old: 'documents_client_key_key', name: 'documents_client_key_key', columns: 'business_id, client_key', where: 'client_key IS NOT NULL', was: '(client_key) WHERE client_key IS NOT NULL' },
  { table: 'documents', old: 'documents_number_key', name: 'documents_number_key', columns: 'business_id, number', was: '(number)' },
  { table: 'documents', old: 'documents_trefin_ref_idx', name: 'documents_trefin_ref_idx', columns: 'business_id, trefin_ref', where: 'trefin_ref IS NOT NULL', was: '(trefin_ref) WHERE trefin_ref IS NOT NULL' },
  { table: 'employees', old: 'employees_user_id_key', name: 'employees_user_id_key', columns: 'business_id, user_id', was: '(user_id)' },
  { table: 'ledger_accounts', old: 'ledger_accounts_number_key', name: 'ledger_accounts_number_key', columns: 'business_id, number', was: '(number)' },
  { table: 'ledger_links', old: 'ledger_links_pkey', name: 'ledger_links_pkey', columns: 'business_id, key', primary: true, was: '(key)' },
  { table: 'makes', old: 'makes_number_key', name: 'makes_number_key', columns: 'business_id, number', was: '(number)' },
  { table: 'money_places', old: 'money_places_shop_till_idx', name: 'money_places_shop_till_idx', columns: 'business_id', where: "kind = 'till' AND carwash_id IS NULL", was: "((true)) WHERE kind = 'till' AND carwash_id IS NULL" },
  { table: 'money_places', old: 'money_places_default_idx', name: 'money_places_default_idx', columns: 'business_id, kind', where: 'is_default', was: '(kind) WHERE is_default' },
  { table: 'no_expense_days', old: 'no_expense_days_pkey', name: 'no_expense_days_pkey', columns: 'business_id, day', primary: true, was: '(day)' },
  { table: 'offers', old: 'offers_number_key', name: 'offers_number_key', columns: 'business_id, number', was: '(number)' },
  { table: 'opening_lines', old: 'opening_lines_stock_idx', name: 'opening_lines_stock_idx', columns: 'business_id', where: "kind = 'stock'", was: "((true)) WHERE kind = 'stock'" },
  { table: 'payroll_months', old: 'payroll_months_live_idx', name: 'payroll_months_live_idx', columns: 'business_id, month', where: 'voided_at IS NULL', was: '(month) WHERE voided_at IS NULL' },
  { table: 'portal_users', old: 'portal_users_email_idx', name: 'portal_users_email_idx', columns: 'business_id, lower(email)', where: 'removed_at IS NULL AND email IS NOT NULL', was: '(lower(email)) WHERE removed_at IS NULL AND email IS NOT NULL' },
  { table: 'product_barcodes', old: 'product_barcodes_barcode_key', name: 'product_barcodes_barcode_key', columns: 'business_id, barcode', was: '(barcode)' },
  { table: 'products', old: 'products_scale_plu_unique', name: 'products_scale_plu_unique', columns: 'business_id, scale_plu', where: 'scale_plu IS NOT NULL AND deleted_at IS NULL', was: '(scale_plu) WHERE scale_plu IS NOT NULL AND deleted_at IS NULL' },
  { table: 'products', old: 'idx_products_barcode_active', name: 'idx_products_barcode_active', columns: 'business_id, barcode', where: 'deleted_at IS NULL AND barcode IS NOT NULL', was: '(barcode) WHERE deleted_at IS NULL AND barcode IS NOT NULL' },
  { table: 'products', old: 'idx_products_sku_active', name: 'idx_products_sku_active', columns: 'business_id, sku', where: 'deleted_at IS NULL AND sku IS NOT NULL', was: '(sku) WHERE deleted_at IS NULL AND sku IS NOT NULL' },
  { table: 'projects', old: 'projects_name_idx', name: 'projects_name_idx', columns: 'business_id, lower(name)', was: '(lower(name))' },
  { table: 'report_subscriptions', old: 'report_subscriptions_pkey', name: 'report_subscriptions_pkey', columns: 'business_id, user_id', primary: true, was: '(user_id)' },
  { table: 'settings', old: 'settings_pkey', name: 'settings_pkey', columns: 'business_id, key', primary: true, was: '(key)' },
  { table: 'stock_documents', old: 'stock_documents_number_key', name: 'stock_documents_number_key', columns: 'business_id, number', was: '(number)' },
  { table: 'stock_locations', old: 'stock_locations_sells_idx', name: 'stock_locations_sells_idx', columns: 'business_id', where: 'sells_here', was: '(sells_here) WHERE sells_here' },
  { table: 'stock_locations', old: 'stock_locations_receives_idx', name: 'stock_locations_receives_idx', columns: 'business_id', where: 'receives_here', was: '(receives_here) WHERE receives_here' },
  { table: 'stock_locations', old: 'stock_locations_name_idx', name: 'stock_locations_name_idx', columns: 'business_id, lower(name)', where: 'removed_at IS NULL', was: '(lower(name)) WHERE removed_at IS NULL' },
  { table: 'stock_moves', old: 'stock_moves_number_key', name: 'stock_moves_number_key', columns: 'business_id, number', was: '(number)' },
  { table: 'supplier_bills', old: 'supplier_bills_trefin_ref_idx', name: 'supplier_bills_trefin_ref_idx', columns: 'business_id, trefin_ref', where: 'trefin_ref IS NOT NULL', was: '(trefin_ref) WHERE trefin_ref IS NOT NULL' },
  { table: 'tax_declarations', old: 'tax_declarations_pkey', name: 'tax_declarations_pkey', columns: 'business_id, year', primary: true, was: '(year)' },
  { table: 'tax_instalments', old: 'tax_instalments_quarter_idx', name: 'tax_instalments_quarter_idx', columns: 'business_id, year, quarter', where: 'undone_at IS NULL', was: '(year, quarter) WHERE undone_at IS NULL' },
  { table: 'trefin_deleted_receipts', old: 'trefin_deleted_receipts_trefin_ref_key', name: 'trefin_deleted_receipts_trefin_ref_key', columns: 'business_id, trefin_ref', was: '(trefin_ref)' },
  { table: 'trefin_journal_entries', old: 'trefin_journal_entries_trefin_ref_key', name: 'trefin_journal_entries_trefin_ref_key', columns: 'business_id, trefin_ref', was: '(trefin_ref)' },
  { table: 'trefin_money_lines', old: 'trefin_money_lines_trefin_ref_key', name: 'trefin_money_lines_trefin_ref_key', columns: 'business_id, trefin_ref', was: '(trefin_ref)' },
  { table: 'trefin_months', old: 'trefin_months_pkey', name: 'trefin_months_pkey', columns: 'business_id, month', primary: true, was: '(month)' },
  { table: 'trefin_offers', old: 'trefin_offers_trefin_ref_key', name: 'trefin_offers_trefin_ref_key', columns: 'business_id, trefin_ref', was: '(trefin_ref)' },
  { table: 'trefin_stock_documents', old: 'trefin_stock_documents_trefin_ref_key', name: 'trefin_stock_documents_trefin_ref_key', columns: 'business_id, trefin_ref', was: '(trefin_ref)' },
  { table: 'vat_months', old: 'vat_months_pkey', name: 'vat_months_pkey', columns: 'business_id, month', primary: true, was: '(month)' },
];

/** cash_counts / cash_openings treat two empty carwashes as the same drawer. */
const NULLS_NOT_DISTINCT = new Set(['cash_counts', 'cash_openings']);

async function dropKey(db: Kysely<unknown>, table: string, name: string): Promise<void> {
  const constraint = await sql<{ n: number }>`
    SELECT 1 AS n FROM pg_constraint WHERE conname = ${name} AND conrelid = ${table}::regclass
  `.execute(db);
  if (constraint.rows.length > 0) {
    await sql`ALTER TABLE ${sql.table(table)} DROP CONSTRAINT ${sql.ref(name)}`.execute(db);
  } else {
    await sql`DROP INDEX ${sql.ref(name)}`.execute(db);
  }
}

/** Plain-column keys become constraints (ON CONFLICT can name them by columns); keys on expressions or with WHERE stay indexes. */
function isPlain(columns: string, where?: string): boolean {
  return !where && !columns.includes('(');
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '10s'`.execute(db);
  for (const key of KEYS) {
    await dropKey(db, key.table, key.old);
    const nulls = NULLS_NOT_DISTINCT.has(key.table) ? sql.raw(' NULLS NOT DISTINCT') : sql.raw('');
    if (key.primary) {
      await sql`ALTER TABLE ${sql.table(key.table)} ADD CONSTRAINT ${sql.ref(key.name)} PRIMARY KEY (${sql.raw(key.columns)})`.execute(db);
    } else if (isPlain(key.columns, key.where)) {
      await sql`ALTER TABLE ${sql.table(key.table)} ADD CONSTRAINT ${sql.ref(key.name)} UNIQUE${nulls} (${sql.raw(key.columns)})`.execute(db);
    } else {
      const where = key.where ? sql.raw(` WHERE ${key.where}`) : sql.raw('');
      await sql`CREATE UNIQUE INDEX ${sql.ref(key.name)} ON ${sql.table(key.table)} (${sql.raw(key.columns)})${nulls}${where}`.execute(db);
    }
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const key of [...KEYS].reverse()) {
    await dropKey(db, key.table, key.name);
    const nulls = NULLS_NOT_DISTINCT.has(key.table) ? ' NULLS NOT DISTINCT' : '';
    const [cols, where] = key.was.split(' WHERE ');
    if (key.primary) {
      await sql`ALTER TABLE ${sql.table(key.table)} ADD CONSTRAINT ${sql.ref(key.old)} PRIMARY KEY ${sql.raw(cols!)}`.execute(db);
    } else if (!where && !cols!.includes('lower(') && !cols!.includes('(true)')) {
      await sql`ALTER TABLE ${sql.table(key.table)} ADD CONSTRAINT ${sql.ref(key.old)} UNIQUE${sql.raw(nulls)} ${sql.raw(cols!)}`.execute(db);
    } else {
      await sql`CREATE UNIQUE INDEX ${sql.ref(key.old)} ON ${sql.table(key.table)} ${sql.raw(cols!)}${sql.raw(nulls)}${sql.raw(where ? ` WHERE ${where}` : '')}`.execute(db);
    }
  }
}
