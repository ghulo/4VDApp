import { type Kysely, sql } from 'kysely';

/**
 * TREFIN's journal, read-only "before 4VD" entries in Books: one entry per
 * TREFIN document (a day's receipts and a day's cash collected each make
 * one, as 4VD posts takings), its lines summed per account. They count in no
 * 4VD balance: the opening balances already hold where TREFIN ended.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE trefin_journal_entries (
      id SERIAL PRIMARY KEY,
      trefin_ref VARCHAR(120) NOT NULL UNIQUE,
      dated DATE NOT NULL,
      -- What it was, as a word the dashboard translates: 'receipts', 'cash_in', 'bill', 'bill_paid', 'opening', ...
      kind VARCHAR(20) NOT NULL,
      -- TREFIN's document number
      reference VARCHAR(80),
      -- Which TREFIN database
      source VARCHAR(40) NOT NULL
    )
  `.execute(db);
  await sql`CREATE INDEX trefin_journal_entries_dated_idx ON trefin_journal_entries (dated, id)`.execute(db);
  await sql`
    CREATE TABLE trefin_journal_lines (
      id SERIAL PRIMARY KEY,
      entry_id INTEGER NOT NULL REFERENCES trefin_journal_entries(id) ON DELETE CASCADE,
      -- The entry's day again, so an account's card reads one index
      dated DATE NOT NULL,
      account VARCHAR(10) NOT NULL,
      -- The supplier or customer, by name, when TREFIN named one
      party VARCHAR(200),
      debit NUMERIC(14, 2) NOT NULL DEFAULT 0,
      credit NUMERIC(14, 2) NOT NULL DEFAULT 0
    )
  `.execute(db);
  await sql`CREATE INDEX trefin_journal_lines_entry_idx ON trefin_journal_lines (entry_id)`.execute(db);
  await sql`CREATE INDEX trefin_journal_lines_account_idx ON trefin_journal_lines (account, dated)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS trefin_journal_lines`.execute(db);
  await sql`DROP TABLE IF EXISTS trefin_journal_entries`.execute(db);
}
