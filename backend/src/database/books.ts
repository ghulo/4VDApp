import { type Kysely, sql } from 'kysely';
import { DEFAULT_ACCOUNT_LINKS, TREFIN_ACCOUNTS } from '../constants/chartOfAccounts.js';

/**
 * Empty the books and put back TREFIN's chart of accounts and the default
 * links. Used by the migration that creates the books and by tests; never on a
 * shop that is running, since it throws away every entry.
 */
export async function seedBooks(db: Kysely<unknown>): Promise<void> {
  await sql`TRUNCATE ledger_queue, ledger_lines, ledger_entries, ledger_links, ledger_accounts RESTART IDENTITY`.execute(db);
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
