import { type Kysely, sql } from 'kysely';

const COST_CATEGORIES = [
  'rent', 'electricity', 'water', 'internet', 'fuel', 'transport', 'repairs', 'cleaning', 'advertising',
  'bank_fees', 'professional', 'insurance', 'office', 'supplies', 'wages', 'taxes', 'other',
];
const EQUIPMENT_CATEGORIES = ['furniture', 'equipment', 'vehicle', 'building', 'other'];
const WITHHOLDING_TYPES = ['interest', 'royalties', 'lottery', 'rent', 'entertainers', 'nonresident_services', 'special'];
const NEW_LINKS: Record<string, string> = {
  'expense:internet': '6690',
  'expense:fuel': '6110',
  'expense:transport': '6740',
  'expense:cleaning': '6130',
  'expense:advertising': '6010',
  'expense:bank_fees': '6060',
  'expense:professional': '6570',
  'expense:insurance': '6450',
  'expense:office': '6780',
  'asset:furniture': '1600',
  'asset:equipment': '1700',
  'asset:vehicle': '1710',
  'asset:building': '1800',
  'asset:other': '1970',
  withholding: '2370',
};

const list = (values: string[]) => sql.raw(values.map((value) => `'${value}'`).join(', '));

/**
 * Every kind of supplier bill on one record, with no document type to pick.
 *
 * A bill has lines, each a product (into stock), a cost with a plain category
 * (booked to its expense account) or equipment (a fixed asset). A supplier
 * marked "abroad" makes it an import: the customs VAT and duty come from the
 * customs paper, the duty and transport are spread onto the goods' cost, and
 * services bought abroad get VAT charged to the shop itself both ways. Tax held
 * back (withholding) is taken off what the supplier is owed. A return or credit
 * is a bill of kind 'credit' against the bill it corrects; what it gives back
 * is applied to that bill as a payment of method 'credit'.
 *
 * Expenses become bills paid on the spot ("paid now"): each one moves over
 * with one cost line (keeping its id as the line's id) and a cash payment on
 * its day, so the books, VAT and supplier history are in one place. Their
 * monthly rules become repeating bills, which any bill can have.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE suppliers
      ADD COLUMN abroad BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN usual_kind VARCHAR(12) CHECK (usual_kind IN ('product', 'cost', 'equipment')),
      ADD COLUMN usual_category VARCHAR(32),
      ADD COLUMN usual_vat_rate SMALLINT CHECK (usual_vat_rate IN (0, 8, 18)),
      ADD COLUMN withholding_type VARCHAR(32) CHECK (withholding_type IN (${list(WITHHOLDING_TYPES)}))
  `.execute(db);

  await sql`
    CREATE TABLE bill_repeats (
      id SERIAL PRIMARY KEY,
      supplier_id INT REFERENCES suppliers(id),
      -- The bill to make each month, as the bill form sent it, without its dates.
      template JSONB NOT NULL,
      -- What each month's bill comes to and its first line's category, for lists.
      amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      category VARCHAR(32),
      place VARCHAR(16) NOT NULL DEFAULT 'shop' CHECK (place IN ('shop', 'carwash', 'both')),
      carwash_id INT REFERENCES carwashes(id),
      note TEXT,
      day_of_month INT NOT NULL CHECK (day_of_month BETWEEN 1 AND 28),
      last_filled_on DATE NOT NULL,
      stopped_at TIMESTAMPTZ,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    ALTER TABLE supplier_bills
      ALTER COLUMN supplier_id DROP NOT NULL,
      ADD COLUMN kind VARCHAR(10) NOT NULL DEFAULT 'bill' CHECK (kind IN ('bill', 'credit')),
      ADD COLUMN credit_for_id INT REFERENCES supplier_bills(id),
      ADD COLUMN returns_stock BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN prices_include_vat BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN abroad BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN customs_vat NUMERIC(12, 2) CHECK (customs_vat >= 0),
      ADD COLUMN customs_duty NUMERIC(12, 2) CHECK (customs_duty >= 0),
      ADD COLUMN customs_paid_method VARCHAR(12) CHECK (customs_paid_method IN ('bank', 'cash')),
      ADD COLUMN withholding_type VARCHAR(32) CHECK (withholding_type IN (${list(WITHHOLDING_TYPES)})),
      ADD COLUMN withheld NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (withheld >= 0),
      ADD COLUMN paid_now BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN place VARCHAR(16) NOT NULL DEFAULT 'shop' CHECK (place IN ('shop', 'carwash', 'both')),
      ADD COLUMN carwash_id INT REFERENCES carwashes(id),
      ADD COLUMN repeat_id INT REFERENCES bill_repeats(id) ON DELETE SET NULL,
      ADD COLUMN legacy_expense_id INT,
      ADD CONSTRAINT supplier_bills_credit_check CHECK ((kind = 'credit') = (credit_for_id IS NOT NULL)),
      ADD CONSTRAINT supplier_bills_repeat_day UNIQUE (repeat_id, issued_on)
  `.execute(db);
  await sql`CREATE INDEX supplier_bills_issued_idx ON supplier_bills (issued_on) WHERE voided_at IS NULL`.execute(db);
  await sql`CREATE INDEX supplier_bills_credit_idx ON supplier_bills (credit_for_id) WHERE credit_for_id IS NOT NULL`.execute(db);

  await sql`
    CREATE TABLE bill_lines (
      id SERIAL PRIMARY KEY,
      bill_id INT NOT NULL REFERENCES supplier_bills(id) ON DELETE CASCADE,
      position SMALLINT NOT NULL,
      kind VARCHAR(12) NOT NULL CHECK (kind IN ('product', 'cost', 'equipment')),
      product_id INT REFERENCES products(id),
      quantity INT CHECK (quantity > 0),
      -- A product's price for one, as the paper shows it (with or without VAT, as the bill says).
      unit_price NUMERIC(12, 4) CHECK (unit_price >= 0),
      category VARCHAR(32),
      description VARCHAR(300),
      vat_rate SMALLINT NOT NULL DEFAULT 0 CHECK (vat_rate IN (0, 8, 18)),
      -- As on the paper: without VAT, and its VAT.
      net NUMERIC(12, 2) NOT NULL,
      vat NUMERIC(12, 2) NOT NULL DEFAULT 0,
      -- What the line puts on the books: its net plus its share of an import's duty and transport.
      landed NUMERIC(12, 2) NOT NULL,
      -- Transport on an import, spread onto the goods' cost instead of booked as a cost.
      spread BOOLEAN NOT NULL DEFAULT false,
      -- VAT on a service from abroad that the shop charges itself, both ways.
      self_vat NUMERIC(12, 2) NOT NULL DEFAULT 0,
      -- Set when the stock came in through a delivery (an order), not through the bill.
      order_line_id INT REFERENCES purchase_order_lines(id) ON DELETE SET NULL,
      CHECK (kind <> 'product' OR (product_id IS NOT NULL AND quantity IS NOT NULL)),
      CHECK (kind <> 'cost' OR category IN (${list(COST_CATEGORIES)})),
      CHECK (kind <> 'equipment' OR category IN (${list(EQUIPMENT_CATEGORIES)}))
    )
  `.execute(db);
  await sql`CREATE INDEX bill_lines_bill_idx ON bill_lines (bill_id, position)`.execute(db);
  await sql`CREATE INDEX bill_lines_product_idx ON bill_lines (product_id) WHERE product_id IS NOT NULL`.execute(db);
  await sql`CREATE INDEX bill_lines_cost_idx ON bill_lines (category) WHERE kind = 'cost'`.execute(db);
  await sql`
    CREATE TRIGGER bill_lines_ledger AFTER INSERT OR UPDATE OR DELETE ON bill_lines
    FOR EACH ROW EXECUTE FUNCTION ledger_enqueue('supplier_bills', 'bill_id')
  `.execute(db);

  await sql`ALTER TABLE supplier_payments DROP CONSTRAINT IF EXISTS supplier_payments_method_check`.execute(db);
  await sql`
    ALTER TABLE supplier_payments
      ADD CONSTRAINT supplier_payments_method_check CHECK (method IN ('drawer', 'cash', 'bank', 'credit')),
      ADD COLUMN credit_id INT REFERENCES supplier_bills(id),
      ADD CONSTRAINT supplier_payments_credit_check CHECK ((method = 'credit') = (credit_id IS NOT NULL))
  `.execute(db);

  for (const [key, number] of Object.entries(NEW_LINKS)) {
    await sql`INSERT INTO ledger_links (key, account_id) SELECT ${key}, id FROM ledger_accounts WHERE number = ${number} ON CONFLICT (key) DO NOTHING`.execute(db);
  }

  // Monthly expense rules become repeating bills, paid on the spot like the expenses they made.
  await sql`
    INSERT INTO bill_repeats (id, template, amount, category, place, carwash_id, note, day_of_month, last_filled_on, stopped_at, created_by, created_at)
    SELECT id,
      jsonb_build_object(
        'supplierId', null, 'pricesIncludeVat', true, 'note', note, 'place', place, 'carwashId', carwash_id,
        'paidNow', jsonb_build_object('method', 'cash'), 'dueDays', null, 'withholdingType', null,
        'lines', jsonb_build_array(jsonb_build_object('kind', 'cost', 'category', category, 'amount', amount, 'vatRate', 0))
      ),
      amount, category, place, carwash_id, note, day_of_month, last_filled_on, stopped_at, created_by, created_at
    FROM recurring_expenses
  `.execute(db);
  await sql`SELECT setval(pg_get_serial_sequence('bill_repeats', 'id'), greatest((SELECT max(id) FROM bill_repeats), 1), (SELECT max(id) FROM bill_repeats) IS NOT NULL)`.execute(db);

  // Each expense: a bill paid on the spot, one cost line keeping the expense's id, and its payment.
  await sql`
    INSERT INTO supplier_bills (issued_on, amount, vat_amount, note, created_by, created_at, paid_now, place, carwash_id, repeat_id, legacy_expense_id)
    SELECT day, amount, 0, note, created_by, created_at, true, place, carwash_id, recurring_id, id FROM expenses ORDER BY id
  `.execute(db);
  await sql`
    INSERT INTO bill_lines (id, bill_id, position, kind, category, vat_rate, net, vat, landed)
    SELECT e.id, b.id, 1, 'cost', e.category, 0, e.amount, 0, e.amount
    FROM expenses e JOIN supplier_bills b ON b.legacy_expense_id = e.id
  `.execute(db);
  await sql`SELECT setval(pg_get_serial_sequence('bill_lines', 'id'), greatest((SELECT max(id) FROM bill_lines), 1), (SELECT max(id) FROM bill_lines) IS NOT NULL)`.execute(db);
  // Bills from deliveries get their products as lines, so every bill reads the same way. This comes after
  // the expense lines, which keep their expenses' ids, so the new ids start above them.
  await sql`
    INSERT INTO bill_lines (bill_id, position, kind, product_id, quantity, unit_price, vat_rate, net, vat, landed, order_line_id)
    SELECT b.id, row_number() OVER (PARTITION BY b.id ORDER BY l.id), 'product', l.product_id, l.received_quantity, l.unit_cost, p.vat_rate,
      x.gross - x.vat, x.vat, x.gross - x.vat, l.id
    FROM supplier_bills b
    JOIN purchase_order_lines l ON l.order_id = b.order_id AND l.received_quantity > 0
    JOIN products p ON p.id = l.product_id
    CROSS JOIN LATERAL (
      SELECT round(l.received_quantity * coalesce(l.unit_cost, 0), 2) AS gross,
             round(round(l.received_quantity * coalesce(l.unit_cost, 0), 2) * p.vat_rate / (100 + p.vat_rate), 2) AS vat
    ) x
  `.execute(db);

  await sql`
    INSERT INTO supplier_payments (bill_id, amount, paid_on, method, created_by, created_at)
    SELECT b.id, e.amount, e.day, 'cash', e.created_by, e.created_at
    FROM expenses e JOIN supplier_bills b ON b.legacy_expense_id = e.id
  `.execute(db);
  // Their old entries are reversed the next time the books post; the bills post in their place.
  await sql`INSERT INTO ledger_queue (source_table, row_id) SELECT 'expenses', id FROM expenses ON CONFLICT DO NOTHING`.execute(db);
  await sql`ALTER TABLE supplier_bills DROP COLUMN legacy_expense_id`.execute(db);

  await sql`DROP TABLE expenses`.execute(db);
  await sql`DROP TABLE recurring_expenses`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Bills paid on the spot with one cost line go back to being expenses; everything else about bills goes.
  await sql`
    CREATE TABLE recurring_expenses (
      id SERIAL PRIMARY KEY,
      amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      category VARCHAR(32) NOT NULL,
      place VARCHAR(16) NOT NULL CHECK (place IN ('shop', 'carwash', 'both')),
      carwash_id INT REFERENCES carwashes(id),
      note TEXT,
      day_of_month INT NOT NULL CHECK (day_of_month BETWEEN 1 AND 28),
      last_filled_on DATE NOT NULL,
      stopped_at TIMESTAMPTZ,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE TABLE expenses (
      id SERIAL PRIMARY KEY,
      day DATE NOT NULL,
      amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      category VARCHAR(32) NOT NULL,
      place VARCHAR(16) NOT NULL CHECK (place IN ('shop', 'carwash', 'both')),
      carwash_id INT REFERENCES carwashes(id),
      note TEXT,
      recurring_id INT REFERENCES recurring_expenses(id) ON DELETE SET NULL,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (recurring_id, day)
    )
  `.execute(db);
  await sql`CREATE INDEX expenses_day_idx ON expenses (day)`.execute(db);
  await sql`
    CREATE TRIGGER expenses_ledger AFTER INSERT OR UPDATE OR DELETE ON expenses
    FOR EACH ROW EXECUTE FUNCTION ledger_enqueue('expenses', 'id')
  `.execute(db);
  await sql`
    INSERT INTO recurring_expenses (id, amount, category, place, carwash_id, note, day_of_month, last_filled_on, stopped_at, created_by, created_at)
    SELECT id, amount, coalesce(category, 'other'), place, carwash_id, note, day_of_month, last_filled_on, stopped_at, created_by, created_at
    FROM bill_repeats WHERE supplier_id IS NULL AND category IS NOT NULL
  `.execute(db);
  await sql`SELECT setval(pg_get_serial_sequence('recurring_expenses', 'id'), greatest((SELECT max(id) FROM recurring_expenses), 1), (SELECT max(id) FROM recurring_expenses) IS NOT NULL)`.execute(db);
  await sql`
    INSERT INTO expenses (id, day, amount, category, place, carwash_id, note, recurring_id, created_by, created_at)
    SELECT l.id, b.issued_on, l.net + l.vat, l.category, b.place, b.carwash_id, b.note,
      (SELECT r.id FROM recurring_expenses r WHERE r.id = b.repeat_id), b.created_by, b.created_at
    FROM supplier_bills b JOIN bill_lines l ON l.bill_id = b.id AND l.kind = 'cost'
    WHERE b.paid_now AND b.voided_at IS NULL AND b.kind = 'bill' AND (SELECT count(*) FROM bill_lines x WHERE x.bill_id = b.id) = 1
  `.execute(db);
  await sql`SELECT setval(pg_get_serial_sequence('expenses', 'id'), greatest((SELECT max(id) FROM expenses), 1), (SELECT max(id) FROM expenses) IS NOT NULL)`.execute(db);
  await sql`
    DELETE FROM supplier_payments WHERE method = 'credit' OR bill_id IN (
      SELECT b.id FROM supplier_bills b WHERE b.paid_now AND b.supplier_id IS NULL OR b.kind = 'credit'
    )
  `.execute(db);
  await sql`DELETE FROM supplier_bills WHERE (paid_now AND supplier_id IS NULL) OR kind = 'credit'`.execute(db);
  await sql`DROP TABLE bill_lines`.execute(db);
  await sql`
    ALTER TABLE supplier_payments
      DROP CONSTRAINT supplier_payments_credit_check,
      DROP CONSTRAINT supplier_payments_method_check,
      DROP COLUMN credit_id,
      ADD CONSTRAINT supplier_payments_method_check CHECK (method IN ('drawer', 'cash', 'bank'))
  `.execute(db);
  await sql`
    ALTER TABLE supplier_bills
      DROP CONSTRAINT supplier_bills_repeat_day,
      DROP CONSTRAINT supplier_bills_credit_check,
      DROP COLUMN kind, DROP COLUMN credit_for_id, DROP COLUMN returns_stock, DROP COLUMN prices_include_vat,
      DROP COLUMN abroad, DROP COLUMN customs_vat, DROP COLUMN customs_duty, DROP COLUMN customs_paid_method,
      DROP COLUMN withholding_type, DROP COLUMN withheld, DROP COLUMN paid_now, DROP COLUMN place,
      DROP COLUMN carwash_id, DROP COLUMN repeat_id
  `.execute(db);
  await sql`DROP INDEX IF EXISTS supplier_bills_issued_idx`.execute(db);
  await sql`DELETE FROM supplier_bills WHERE supplier_id IS NULL`.execute(db);
  await sql`ALTER TABLE supplier_bills ALTER COLUMN supplier_id SET NOT NULL`.execute(db);
  await sql`DROP TABLE bill_repeats`.execute(db);
  await sql`
    ALTER TABLE suppliers
      DROP COLUMN abroad, DROP COLUMN usual_kind, DROP COLUMN usual_category, DROP COLUMN usual_vat_rate, DROP COLUMN withholding_type
  `.execute(db);
  await sql`DELETE FROM ledger_links WHERE key LIKE 'asset:%' OR key = 'withholding' OR key IN (${list(Object.keys(NEW_LINKS))})`.execute(db);
}
