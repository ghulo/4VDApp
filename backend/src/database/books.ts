import { type Kysely, sql } from 'kysely';
import { DEFAULT_ACCOUNT_LINKS, TREFIN_ACCOUNTS } from '../constants/chartOfAccounts.js';

/**
 * Empty the books and put back TREFIN's chart of accounts and the default
 * links. Used by the migration that creates the books and by tests; never on a
 * shop that is running, since it throws away every entry. The places money is
 * kept get their accounts again the next time they are needed.
 */
export async function seedBooks(db: Kysely<unknown>): Promise<void> {
  // Closed years and profit tax instalments point at entries (from migration 047 on), so they go in the same statement.
  const years = await sql<{ exists: boolean }>`select to_regclass('book_years') is not null as exists`.execute(db);
  if (years.rows[0]?.exists) await sql`TRUNCATE book_years, tax_instalments, ledger_queue, ledger_lines, ledger_entries, ledger_links RESTART IDENTITY`.execute(db);
  else await sql`TRUNCATE ledger_queue, ledger_lines, ledger_entries, ledger_links RESTART IDENTITY`.execute(db);
  // Places point at accounts, so the accounts are deleted rather than truncated.
  const places = await sql<{ exists: boolean }>`select to_regclass('money_places') is not null as exists`.execute(db);
  if (places.rows[0]?.exists) await sql`UPDATE money_places SET account_id = NULL`.execute(db);
  await sql`DELETE FROM ledger_accounts`.execute(db);
  await sql`ALTER SEQUENCE ledger_accounts_id_seq RESTART`.execute(db);
  for (const account of TREFIN_ACCOUNTS) {
    await sql`
      INSERT INTO ledger_accounts (number, name, class, type_name, group_name, cash_flow)
      VALUES (${account.number}, ${account.name}, ${account.accountClass}, ${account.type}, ${account.group}, ${account.cashFlow})
    `.execute(db);
  }
  for (const [key, number] of Object.entries(DEFAULT_ACCOUNT_LINKS)) {
    await sql`INSERT INTO ledger_links (key, account_id) SELECT ${key}, id FROM ledger_accounts WHERE number = ${number}`.execute(db);
  }
}
