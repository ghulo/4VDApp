import { type Kysely, sql } from 'kysely';
import { ensurePlaces } from '../places.js';

/**
 * Every place money is kept, and how it moves between them.
 *
 * - `money_places`: the shop's till, each carwash's till, a safe (or cash box)
 *   and each bank account. Each has its own account in the books, under 1110
 *   (cash) or 1120 (bank): the shop's till keeps 1110 itself and the first bank
 *   1120, so nothing already posted moves. A bank account can start from a
 *   balance on a day (`opening_balance` on `opening_day`).
 * - `money_moves`: money taken from one place to another (a deposit, a
 *   withdrawal), or put in or taken out by the owner (one side empty).
 * - Supplier payments and customer payments say which place the money left or
 *   reached. Earlier payments are placed by how they were paid: the drawer is
 *   the shop's till, other cash the safe, a transfer the bank.
 * - `payment_groups`: one payment over several bills of a supplier.
 * - `tab_allocations`: which invoices a customer's payment was for (the rest
 *   pays their oldest charges first, as before).
 * - Bank statements: each uploaded file and its lines, matched to what 4VD
 *   already has or turned into a record; rules say what a kind of line is.
 *
 * The books: the links `cash` and `bank` give way to the places' own accounts,
 * and two new links say where the owner's money goes (3000 put in, 3100 taken
 * out). Moves post through the same queue as everything else.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE money_places (
      id SERIAL PRIMARY KEY,
      kind VARCHAR(5) NOT NULL CHECK (kind IN ('till', 'safe', 'bank')),
      -- Null: the place's usual name in the reader's language (the shop's till, the safe), or its carwash's.
      name VARCHAR(100),
      carwash_id INT REFERENCES carwashes(id),
      bank_name VARCHAR(100),
      iban VARCHAR(34),
      account_id INT REFERENCES ledger_accounts(id),
      -- The safe and the bank account a payment goes to when only "cash" or "bank" was said.
      is_default BOOLEAN NOT NULL DEFAULT false,
      opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
      -- The day the opening balance is at the start of; null: from the very first movement.
      opening_day DATE,
      -- How this bank's statement files are laid out, once someone said so.
      statement_layout JSONB,
      archived_at TIMESTAMPTZ,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (kind = 'till' OR carwash_id IS NULL),
      CHECK (kind = 'bank' OR (bank_name IS NULL AND iban IS NULL)),
      CHECK (kind <> 'till' OR NOT is_default)
    )
  `.execute(db);
  await sql`CREATE UNIQUE INDEX money_places_shop_till_idx ON money_places ((true)) WHERE kind = 'till' AND carwash_id IS NULL`.execute(db);
  await sql`CREATE UNIQUE INDEX money_places_carwash_idx ON money_places (carwash_id) WHERE carwash_id IS NOT NULL`.execute(db);
  await sql`CREATE UNIQUE INDEX money_places_default_idx ON money_places (kind) WHERE is_default`.execute(db);
  await sql`CREATE UNIQUE INDEX money_places_account_idx ON money_places (account_id) WHERE account_id IS NOT NULL`.execute(db);

  await sql`
    CREATE TABLE money_moves (
      id SERIAL PRIMARY KEY,
      day DATE NOT NULL,
      amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
      -- Null on one side: the owner put money in (no "from") or took it out (no "to").
      from_place_id INT REFERENCES money_places(id),
      to_place_id INT REFERENCES money_places(id),
      note VARCHAR(300),
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      voided_at TIMESTAMPTZ,
      voided_by INT REFERENCES users(id) ON DELETE SET NULL,
      CHECK (from_place_id IS NOT NULL OR to_place_id IS NOT NULL),
      CHECK (from_place_id IS DISTINCT FROM to_place_id)
    )
  `.execute(db);
  await sql`CREATE INDEX money_moves_from_idx ON money_moves (from_place_id, day)`.execute(db);
  await sql`CREATE INDEX money_moves_to_idx ON money_moves (to_place_id, day)`.execute(db);
  await sql`
    CREATE TRIGGER money_moves_ledger AFTER INSERT OR UPDATE OR DELETE ON money_moves
    FOR EACH ROW EXECUTE FUNCTION ledger_enqueue('money_moves', 'id')
  `.execute(db);

  await sql`
    CREATE TABLE payment_groups (
      id SERIAL PRIMARY KEY,
      supplier_id INT REFERENCES suppliers(id),
      place_id INT NOT NULL REFERENCES money_places(id),
      paid_on DATE NOT NULL,
      amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
      note VARCHAR(300),
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    ALTER TABLE supplier_payments
      ADD COLUMN place_id INT REFERENCES money_places(id),
      ADD COLUMN group_id INT REFERENCES payment_groups(id)
  `.execute(db);
  await sql`CREATE INDEX supplier_payments_place_idx ON supplier_payments (place_id, paid_on)`.execute(db);
  await sql`CREATE INDEX supplier_payments_group_idx ON supplier_payments (group_id) WHERE group_id IS NOT NULL`.execute(db);
  await sql`ALTER TABLE tab_entries ADD COLUMN place_id INT REFERENCES money_places(id)`.execute(db);
  await sql`CREATE INDEX tab_entries_place_idx ON tab_entries (place_id, occurred_at) WHERE place_id IS NOT NULL`.execute(db);
  await sql`
    CREATE TABLE tab_allocations (
      id SERIAL PRIMARY KEY,
      payment_id INT NOT NULL REFERENCES tab_entries(id) ON DELETE CASCADE,
      -- Null: the charges on the tab that are on no invoice.
      document_id INT REFERENCES documents(id),
      amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0)
    )
  `.execute(db);
  await sql`CREATE INDEX tab_allocations_payment_idx ON tab_allocations (payment_id)`.execute(db);

  await sql`
    CREATE TABLE bank_rules (
      id SERIAL PRIMARY KEY,
      -- Null: every bank account.
      place_id INT REFERENCES money_places(id) ON DELETE CASCADE,
      contains VARCHAR(100) NOT NULL CHECK (length(trim(contains)) > 0),
      direction VARCHAR(3) NOT NULL CHECK (direction IN ('in', 'out')),
      action VARCHAR(10) NOT NULL CHECK (action IN ('expense', 'transfer', 'owner')),
      category VARCHAR(40),
      supplier_id INT REFERENCES suppliers(id) ON DELETE SET NULL,
      other_place_id INT REFERENCES money_places(id) ON DELETE CASCADE,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (action <> 'expense' OR category IS NOT NULL),
      CHECK (action <> 'transfer' OR other_place_id IS NOT NULL)
    )
  `.execute(db);
  await sql`
    CREATE TABLE bank_statements (
      id SERIAL PRIMARY KEY,
      place_id INT NOT NULL REFERENCES money_places(id),
      file_name VARCHAR(200) NOT NULL,
      format VARCHAR(4) NOT NULL CHECK (format IN ('csv', 'xlsx', 'pdf')),
      first_day DATE,
      last_day DATE,
      opening_balance NUMERIC(14, 2),
      closing_balance NUMERIC(14, 2),
      lines_read INT NOT NULL,
      -- Lines already brought in by an earlier statement that overlaps this one.
      lines_skipped INT NOT NULL,
      uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE TABLE bank_lines (
      id SERIAL PRIMARY KEY,
      statement_id INT NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
      place_id INT NOT NULL REFERENCES money_places(id),
      day DATE NOT NULL,
      text VARCHAR(500) NOT NULL,
      -- Money in is above zero, money out below.
      amount NUMERIC(14, 2) NOT NULL CHECK (amount <> 0),
      balance NUMERIC(14, 2),
      -- Day, amount, text and balance, and which of several identical lines: the same line in a later file is skipped.
      fingerprint VARCHAR(600) NOT NULL,
      position INT NOT NULL,
      status VARCHAR(7) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'skipped')),
      -- What it became once done: a supplier payment, several (a group), a customer payment, a move or an expense (a bill).
      done_kind VARCHAR(13) CHECK (done_kind IN ('payment', 'payment_group', 'tab_payment', 'move', 'expense')),
      done_ref INT,
      -- Whether confirming made that record (taking it back removes it) or found it already there.
      made_record BOOLEAN NOT NULL DEFAULT false,
      rule_id INT REFERENCES bank_rules(id) ON DELETE SET NULL,
      done_by INT REFERENCES users(id) ON DELETE SET NULL,
      done_at TIMESTAMPTZ,
      UNIQUE (place_id, fingerprint),
      CHECK ((status = 'done') = (done_kind IS NOT NULL AND done_ref IS NOT NULL))
    )
  `.execute(db);
  await sql`CREATE INDEX bank_lines_statement_idx ON bank_lines (statement_id, position)`.execute(db);
  await sql`CREATE INDEX bank_lines_open_idx ON bank_lines (place_id, day) WHERE status = 'open'`.execute(db);
  await sql`CREATE INDEX bank_lines_done_idx ON bank_lines (done_kind, done_ref) WHERE status = 'done'`.execute(db);

  // The shop's till and the first bank keep the accounts the books used for cash and bank.
  await sql`INSERT INTO money_places (kind, account_id) SELECT 'till', account_id FROM ledger_links WHERE key = 'cash'`.execute(db);
  await sql`
    INSERT INTO money_places (kind, is_default, name, bank_name, iban, account_id)
    SELECT 'bank', true, b.bank_name, b.bank_name, b.iban, l.account_id
    FROM ledger_links l LEFT JOIN LATERAL (SELECT bank_name, iban FROM businesses ORDER BY id LIMIT 1) b ON true
    WHERE l.key = 'bank'
  `.execute(db);
  await ensurePlaces(db);

  // Earlier payments: the drawer is the shop's till (the cash count already took them off it), other cash the safe, a transfer the bank.
  await sql`
    UPDATE supplier_payments sp SET place_id = p.id
    FROM money_places p
    WHERE sp.method <> 'credit' AND (
      (sp.method = 'drawer' AND p.kind = 'till' AND p.carwash_id IS NULL)
      OR (sp.method = 'cash' AND p.kind = 'safe' AND p.is_default)
      OR (sp.method = 'bank' AND p.kind = 'bank' AND p.is_default))
  `.execute(db);
  await sql`ALTER TABLE supplier_payments ADD CONSTRAINT supplier_payments_place_check CHECK ((method = 'credit') = (place_id IS NULL))`.execute(db);
  // Customers have always paid their tab at the shop's till.
  await sql`UPDATE tab_entries SET place_id = (SELECT id FROM money_places WHERE kind = 'till' AND carwash_id IS NULL) WHERE kind = 'payment'`.execute(db);
  await sql`ALTER TABLE tab_entries ADD CONSTRAINT tab_entries_place_check CHECK (kind = 'payment' OR place_id IS NULL)`.execute(db);

  await sql`DELETE FROM ledger_links WHERE key IN ('cash', 'bank')`.execute(db);
  for (const [key, number] of [
    ['owner_in', '3000'],
    ['owner_out', '3100'],
  ] as const) {
    await sql`INSERT INTO ledger_links (key, account_id) SELECT ${key}, id FROM ledger_accounts WHERE number = ${number} ON CONFLICT (key) DO NOTHING`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM ledger_links WHERE key IN ('owner_in', 'owner_out')`.execute(db);
  await sql`
    INSERT INTO ledger_links (key, account_id)
    SELECT 'cash', coalesce((SELECT account_id FROM money_places WHERE kind = 'till' AND carwash_id IS NULL), (SELECT id FROM ledger_accounts WHERE number = '1110'))
    ON CONFLICT (key) DO NOTHING
  `.execute(db);
  await sql`
    INSERT INTO ledger_links (key, account_id)
    SELECT 'bank', coalesce((SELECT account_id FROM money_places WHERE kind = 'bank' AND is_default), (SELECT id FROM ledger_accounts WHERE number = '1120'))
    ON CONFLICT (key) DO NOTHING
  `.execute(db);
  await sql`DROP TABLE IF EXISTS bank_lines`.execute(db);
  await sql`DROP TABLE IF EXISTS bank_statements`.execute(db);
  await sql`DROP TABLE IF EXISTS bank_rules`.execute(db);
  await sql`DROP TABLE IF EXISTS tab_allocations`.execute(db);
  await sql`ALTER TABLE tab_entries DROP CONSTRAINT IF EXISTS tab_entries_place_check, DROP COLUMN IF EXISTS place_id`.execute(db);
  await sql`ALTER TABLE supplier_payments DROP CONSTRAINT IF EXISTS supplier_payments_place_check, DROP COLUMN IF EXISTS group_id, DROP COLUMN IF EXISTS place_id`.execute(db);
  await sql`DROP TABLE IF EXISTS payment_groups`.execute(db);
  await sql`DELETE FROM ledger_queue WHERE source_table = 'money_moves'`.execute(db);
  await sql`DROP TABLE IF EXISTS money_moves`.execute(db);
  await sql`DROP TABLE IF EXISTS money_places`.execute(db);
}
