import { type Kysely, sql } from 'kysely';

/**
 * Financial statements, closing the year and the quarterly profit tax (TM).
 *
 * - Account 8900 for the profit tax itself, below "profit before tax", and
 *   links for it, for what is owed on it (2350) and for retained earnings (3400).
 * - `book_years`: a year that is closed. Its two entries (the year's profit tax
 *   and the closing entry that empties income and cost accounts into retained
 *   earnings) are dated 31 December; nothing dated in a closed year can change.
 *   Reopening reverses both and deletes the row (the reason goes to Activity).
 * - `tax_instalments`: a TM paid for a quarter, from a till, the safe or a bank
 *   account, with the entry it posted. Taking one back reverses the entry.
 */
const LINKS: Record<string, string> = { profit_tax: '8900', profit_tax_payable: '2350', retained_earnings: '3400' };

/** The check on which entries carry a source (its name was made up by Postgres in 039, so it is found by what it says). */
async function dropSourceCheck(db: Kysely<unknown>): Promise<void> {
  const { rows } = await sql<{ conname: string }>`
    select conname from pg_constraint
    where conrelid = 'ledger_entries'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%source_key%'
  `.execute(db);
  for (const row of rows) await sql`ALTER TABLE ledger_entries DROP CONSTRAINT ${sql.id(row.conname)}`.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO ledger_accounts (number, name, class, type_name, group_name, cash_flow)
    VALUES ('8900', 'Shpenzimet e tatimit në fitim', 'other_expense', 'Shpenzimet tjera', 'Tatimi në fitim', 'operating')
    ON CONFLICT (number) DO NOTHING
  `.execute(db);
  for (const [key, number] of Object.entries(LINKS)) {
    await sql`INSERT INTO ledger_links (key, account_id) SELECT ${key}, id FROM ledger_accounts WHERE number = ${number} ON CONFLICT (key) DO NOTHING`.execute(db);
  }

  // A hand-written entry had no source; the year's entries and TM payments are written by 4VD but are not documents, so they say what made them.
  await dropSourceCheck(db);
  await sql`
    ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_source_check CHECK (
      kind = 'reversal' OR (kind = 'auto' AND source_key IS NOT NULL) OR (kind = 'manual' AND (source_key IS NULL OR source_key ~ '^(year_close|profit_tax|tm):'))
    )
  `.execute(db);

  await sql`
    CREATE TABLE book_years (
      year INT PRIMARY KEY CHECK (year BETWEEN 2000 AND 2200),
      profit NUMERIC(14, 2) NOT NULL,
      tax NUMERIC(14, 2) NOT NULL,
      tax_entry_id INT REFERENCES ledger_entries(id),
      close_entry_id INT REFERENCES ledger_entries(id),
      closed_by INT REFERENCES users(id) ON DELETE SET NULL,
      closed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE TABLE tax_instalments (
      id SERIAL PRIMARY KEY,
      year INT NOT NULL CHECK (year BETWEEN 2000 AND 2200),
      quarter SMALLINT NOT NULL CHECK (quarter BETWEEN 1 AND 4),
      amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
      paid_on DATE NOT NULL,
      place_id INT NOT NULL REFERENCES money_places(id),
      entry_id INT REFERENCES ledger_entries(id),
      note VARCHAR(300),
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      undone_at TIMESTAMPTZ,
      undone_by INT REFERENCES users(id) ON DELETE SET NULL
    )
  `.execute(db);
  await sql`CREATE UNIQUE INDEX tax_instalments_quarter_idx ON tax_instalments (year, quarter) WHERE undone_at IS NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS tax_instalments`.execute(db);
  await sql`DROP TABLE IF EXISTS book_years`.execute(db);
  await sql`DELETE FROM ledger_entries WHERE reverses_id IN (SELECT id FROM ledger_entries WHERE kind = 'manual' AND source_key IS NOT NULL)`.execute(db);
  await sql`DELETE FROM ledger_entries WHERE kind = 'manual' AND source_key IS NOT NULL`.execute(db);
  await dropSourceCheck(db);
  await sql`ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_check1 CHECK ((kind = 'manual') = (source_key IS NULL) OR kind = 'reversal')`.execute(db);
  await sql`DELETE FROM ledger_links WHERE key IN ('profit_tax', 'profit_tax_payable', 'retained_earnings')`.execute(db);
  await sql`DELETE FROM ledger_accounts a WHERE a.number = '8900' AND NOT EXISTS (SELECT 1 FROM ledger_lines l WHERE l.account_id = a.id)`.execute(db);
}
