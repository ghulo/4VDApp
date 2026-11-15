import { type Kysely, sql } from 'kysely';

const NEW_ACCOUNTS = [
  { number: '1960', name: 'Amortizimi i akumuluar, Pasuritë e paprekshme' },
  { number: '1980', name: 'Pasuritë e paprekshme' },
];
const NEW_LINKS: Record<string, string> = {
  'asset:land': '1850',
  'asset:intangible': '1980',
  'accumulated:furniture': '1910',
  'accumulated:equipment': '1920',
  'accumulated:vehicle': '1930',
  'accumulated:building': '1950',
  'accumulated:other': '1940',
  'accumulated:intangible': '1960',
  depreciation: '6150',
  amortisation: '6040',
  asset_gain: '7200',
  asset_loss: '8200',
};

/**
 * The fixed assets register: things the business owns and uses for more than
 * a year (a fridge, the till, a van), with what each cost and how fast it wears
 * out (a yearly rate, straight-line). An asset comes from an equipment line on
 * a supplier bill (the bill posted its cost) or is typed in as already owned
 * (its cost and wear so far are in the opening balances). Each finished month
 * gets one depreciation entry for every asset; the amounts are stored per asset
 * and month, so changing an asset only changes the months still to come. An
 * asset is sold, thrown away or given back to the supplier (a credit bill) at
 * most once; that posts one entry of its own.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  for (const account of NEW_ACCOUNTS) {
    await sql`
      INSERT INTO ledger_accounts (number, name, class, type_name, group_name, cash_flow)
      SELECT ${account.number}, ${account.name}, 'asset', 'Pasuria Themelore',
        ${account.number === '1960' ? 'Zhvlerësimi i akumuluar' : 'Pasuritë e paprekshme'}, 'investing'
      WHERE NOT EXISTS (SELECT 1 FROM ledger_accounts WHERE number = ${account.number})
    `.execute(db);
  }
  for (const [key, number] of Object.entries(NEW_LINKS)) {
    await sql`INSERT INTO ledger_links (key, account_id) SELECT ${key}, id FROM ledger_accounts WHERE number = ${number} ON CONFLICT (key) DO NOTHING`.execute(db);
  }

  await sql`
    CREATE TABLE fixed_assets (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      -- An inventory tag or serial number, as the owner writes it on the thing.
      code VARCHAR(60),
      category VARCHAR(12) NOT NULL CHECK (category IN ('furniture', 'equipment', 'vehicle', 'building', 'land', 'intangible', 'other')),
      bought_on DATE NOT NULL,
      -- Depreciation starts the month after this day.
      in_use_from DATE NOT NULL,
      -- Without VAT: what the bill line put on the books, or what the opening balances hold.
      cost NUMERIC(12, 2) NOT NULL CHECK (cost > 0),
      -- What it should still be worth when worn out; depreciation stops there.
      residual NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (residual >= 0),
      -- A year's depreciation as a share of the cost, straight-line.
      rate NUMERIC(5, 2) NOT NULL CHECK (rate >= 0 AND rate <= 100),
      -- Depreciation before the books started (or before 4VD), held in the opening balances.
      opening_depreciated NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (opening_depreciated >= 0),
      -- Set when it came from a bill; null when typed in as already owned.
      bill_line_id INT REFERENCES bill_lines(id) ON DELETE SET NULL,
      place VARCHAR(10) NOT NULL DEFAULT 'shop' CHECK (place IN ('shop', 'carwash')),
      note TEXT,
      -- The last month whose depreciation has been worked out, so the books can tell at a glance when one is due.
      filled_through DATE,
      disposed_on DATE,
      disposal VARCHAR(10) CHECK (disposal IN ('sold', 'scrapped', 'returned')),
      -- A sale: the price without VAT, its VAT, who bought it and where the money went (a place) or is owed (a customer).
      sale_net NUMERIC(12, 2) CHECK (sale_net >= 0),
      sale_vat_rate SMALLINT CHECK (sale_vat_rate IN (0, 8, 18)),
      sale_vat NUMERIC(12, 2) CHECK (sale_vat >= 0),
      buyer_name VARCHAR(200),
      buyer_nui VARCHAR(40),
      customer_id INT REFERENCES customers(id),
      paid_place_id INT REFERENCES money_places(id),
      -- A return to the supplier: the credit bill that took it back.
      credit_bill_id INT REFERENCES supplier_bills(id),
      disposal_note TEXT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      voided_at TIMESTAMPTZ,
      voided_by INT REFERENCES users(id) ON DELETE SET NULL,
      CHECK (residual < cost),
      CHECK ((disposed_on IS NULL) = (disposal IS NULL)),
      CHECK (disposal IS DISTINCT FROM 'sold' OR (sale_net IS NOT NULL AND sale_vat_rate IS NOT NULL AND sale_vat IS NOT NULL)),
      CHECK (disposal IS DISTINCT FROM 'returned' OR credit_bill_id IS NOT NULL)
    )
  `.execute(db);
  await sql`CREATE INDEX fixed_assets_bill_line_idx ON fixed_assets (bill_line_id) WHERE bill_line_id IS NOT NULL`.execute(db);
  await sql`CREATE INDEX fixed_assets_active_idx ON fixed_assets (filled_through) WHERE voided_at IS NULL`.execute(db);

  await sql`
    CREATE TABLE depreciation_months (
      id SERIAL PRIMARY KEY,
      month DATE NOT NULL UNIQUE CHECK (extract(day FROM month) = 1)
    )
  `.execute(db);
  await sql`
    CREATE TABLE depreciation_lines (
      month_id INT NOT NULL REFERENCES depreciation_months(id),
      asset_id INT NOT NULL REFERENCES fixed_assets(id),
      amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      PRIMARY KEY (month_id, asset_id)
    )
  `.execute(db);
  await sql`CREATE INDEX depreciation_lines_asset_idx ON depreciation_lines (asset_id)`.execute(db);

  await sql`
    CREATE TRIGGER fixed_assets_ledger AFTER INSERT OR UPDATE OR DELETE ON fixed_assets
    FOR EACH ROW EXECUTE FUNCTION ledger_enqueue('fixed_assets', 'id')
  `.execute(db);
  await sql`
    CREATE TRIGGER depreciation_lines_ledger AFTER INSERT OR UPDATE OR DELETE ON depreciation_lines
    FOR EACH ROW EXECUTE FUNCTION ledger_enqueue('depreciation_months', 'month_id')
  `.execute(db);

  // Equipment already on bills goes into the register at its line's cost, at the default rate for its kind.
  await sql`
    INSERT INTO fixed_assets (name, category, bought_on, in_use_from, cost, rate, bill_line_id, place, created_by, created_at)
    SELECT coalesce(nullif(l.description, ''), initcap(l.category)), l.category, b.issued_on, b.issued_on, l.landed,
      CASE l.category WHEN 'building' THEN 5 WHEN 'other' THEN 10 ELSE 20 END,
      l.id, CASE WHEN b.place = 'carwash' THEN 'carwash' ELSE 'shop' END, b.created_by, b.created_at
    FROM bill_lines l JOIN supplier_bills b ON b.id = l.bill_id
    WHERE l.kind = 'equipment' AND b.kind = 'bill' AND b.voided_at IS NULL AND l.landed > 0
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM ledger_queue WHERE source_table IN ('fixed_assets', 'depreciation_months')`.execute(db);
  await sql`DROP TABLE IF EXISTS depreciation_lines`.execute(db);
  await sql`DROP TABLE IF EXISTS depreciation_months`.execute(db);
  await sql`DROP TABLE IF EXISTS fixed_assets`.execute(db);
  await sql`DELETE FROM ledger_links WHERE key IN (${sql.join(Object.keys(NEW_LINKS))})`.execute(db);
}
