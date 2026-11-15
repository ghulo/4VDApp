import { type Kysely, sql } from 'kysely';

const NEW_LINKS: Record<string, string> = {
  employer_pension: '6520',
  wages_payable: '2100',
  pension_payable_employer: '2200',
  pension_payable_employee: '2210',
  wage_tax_payable: '2310',
};

/**
 * Employees and payroll. An employee is a person on the payroll, linked to a
 * team account when they have one (not everyone who signs in is paid, and not
 * everyone paid signs in). A payroll month is confirmed once, with one line per
 * person holding every figure as worked out that day, so later changes to the
 * rules or the person never change a confirmed month. Confirming posts one
 * entry; paying wages (to some or all, from one place) and paying ATK (the tax
 * and the pension, two payments) each post their own. Leave taken and leave
 * corrections are rows; what was earned is worked out from the contract.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  for (const [key, number] of Object.entries(NEW_LINKS)) {
    await sql`INSERT INTO ledger_links (key, account_id) SELECT ${key}, id FROM ledger_accounts WHERE number = ${number} ON CONFLICT (key) DO NOTHING`.execute(db);
  }

  await sql`
    CREATE TABLE employees (
      id SERIAL PRIMARY KEY,
      user_id INT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
      name VARCHAR(200) NOT NULL,
      -- The 10-digit Kosovo personal number, as ATK's declaration wants it.
      personal_number VARCHAR(20),
      job_title VARCHAR(120),
      contract VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (contract IN ('open', 'fixed', 'part_time')),
      started_on DATE NOT NULL,
      -- A fixed-term contract's last day.
      contract_ends_on DATE,
      -- The last day worked, once they have left.
      left_on DATE,
      -- What was agreed: a gross amount, or a net amount worked back to gross each month.
      pay_basis VARCHAR(5) NOT NULL DEFAULT 'gross' CHECK (pay_basis IN ('gross', 'net')),
      pay_amount NUMERIC(10, 2) NOT NULL CHECK (pay_amount >= 0),
      -- A second job: taxed at a flat rate, no tax-free part.
      secondary BOOLEAN NOT NULL DEFAULT false,
      -- No Trust pension (a person not resident in Kosovo).
      non_resident BOOLEAN NOT NULL DEFAULT false,
      extra_pension_employee NUMERIC(4, 2) NOT NULL DEFAULT 0 CHECK (extra_pension_employee BETWEEN 0 AND 10),
      extra_pension_employer NUMERIC(4, 2) NOT NULL DEFAULT 0 CHECK (extra_pension_employer BETWEEN 0 AND 10),
      bank_account VARCHAR(40),
      -- Carwash staff are declared with the rest but stay out of the books, like the carwash.
      place VARCHAR(10) NOT NULL DEFAULT 'shop' CHECK (place IN ('shop', 'carwash')),
      -- Paid leave days a year before the extra for years of service.
      leave_days NUMERIC(4, 1) NOT NULL DEFAULT 20 CHECK (leave_days BETWEEN 0 AND 60),
      note TEXT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (contract_ends_on IS NULL OR contract_ends_on >= started_on),
      CHECK (left_on IS NULL OR left_on >= started_on)
    )
  `.execute(db);

  await sql`
    CREATE TABLE payroll_months (
      id SERIAL PRIMARY KEY,
      month DATE NOT NULL CHECK (extract(day FROM month) = 1),
      confirmed_by INT REFERENCES users(id) ON DELETE SET NULL,
      confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      voided_at TIMESTAMPTZ,
      voided_by INT REFERENCES users(id) ON DELETE SET NULL
    )
  `.execute(db);
  await sql`CREATE UNIQUE INDEX payroll_months_live_idx ON payroll_months (month) WHERE voided_at IS NULL`.execute(db);

  await sql`
    CREATE TABLE payroll_lines (
      month_id INT NOT NULL REFERENCES payroll_months(id),
      employee_id INT NOT NULL REFERENCES employees(id),
      place VARCHAR(10) NOT NULL CHECK (place IN ('shop', 'carwash')),
      secondary BOOLEAN NOT NULL,
      non_resident BOOLEAN NOT NULL,
      gross NUMERIC(10, 2) NOT NULL CHECK (gross >= 0),
      employee_rate NUMERIC(5, 2) NOT NULL,
      employer_rate NUMERIC(5, 2) NOT NULL,
      employee_pension NUMERIC(10, 2) NOT NULL,
      employer_pension NUMERIC(10, 2) NOT NULL,
      taxable NUMERIC(10, 2) NOT NULL,
      tax NUMERIC(10, 2) NOT NULL,
      net NUMERIC(10, 2) NOT NULL,
      -- Why the gross differs from the contract this month (a part month, unpaid leave, leave paid out).
      changed_reason TEXT,
      PRIMARY KEY (month_id, employee_id)
    )
  `.execute(db);
  await sql`CREATE INDEX payroll_lines_employee_idx ON payroll_lines (employee_id)`.execute(db);

  await sql`
    CREATE TABLE payroll_payments (
      id SERIAL PRIMARY KEY,
      month_id INT NOT NULL REFERENCES payroll_months(id),
      kind VARCHAR(8) NOT NULL CHECK (kind IN ('wages', 'tax', 'pension')),
      place_id INT NOT NULL REFERENCES money_places(id),
      paid_on DATE NOT NULL,
      amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      -- Of that, what belongs to carwash staff (outside the books).
      carwash_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (carwash_amount >= 0),
      note TEXT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      voided_at TIMESTAMPTZ,
      voided_by INT REFERENCES users(id) ON DELETE SET NULL,
      CHECK (carwash_amount <= amount)
    )
  `.execute(db);
  await sql`CREATE INDEX payroll_payments_month_idx ON payroll_payments (month_id)`.execute(db);
  // Who a wage payment paid, and how much each.
  await sql`
    CREATE TABLE payroll_payment_lines (
      payment_id INT NOT NULL REFERENCES payroll_payments(id),
      employee_id INT NOT NULL REFERENCES employees(id),
      amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
      PRIMARY KEY (payment_id, employee_id)
    )
  `.execute(db);

  await sql`
    CREATE TABLE leave_entries (
      id SERIAL PRIMARY KEY,
      employee_id INT NOT NULL REFERENCES employees(id),
      -- Leave taken (days off), or a correction (an opening balance, days paid out, days given).
      kind VARCHAR(6) NOT NULL CHECK (kind IN ('taken', 'adjust')),
      from_day DATE NOT NULL,
      to_day DATE NOT NULL,
      -- Taken: working days off (positive). A correction: days added (positive) or taken away (negative).
      days NUMERIC(5, 1) NOT NULL CHECK (days <> 0),
      note TEXT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (to_day >= from_day),
      CHECK (kind = 'adjust' OR days > 0)
    )
  `.execute(db);
  await sql`CREATE INDEX leave_entries_employee_idx ON leave_entries (employee_id, from_day)`.execute(db);

  await sql`ALTER TABLE bank_lines DROP CONSTRAINT IF EXISTS bank_lines_done_kind_check`.execute(db);
  await sql`
    ALTER TABLE bank_lines ADD CONSTRAINT bank_lines_done_kind_check
    CHECK (done_kind IN ('payment', 'payment_group', 'tab_payment', 'move', 'expense', 'payroll'))
  `.execute(db);

  await sql`
    CREATE TRIGGER payroll_months_ledger AFTER INSERT OR UPDATE OR DELETE ON payroll_months
    FOR EACH ROW EXECUTE FUNCTION ledger_enqueue('payroll_months', 'id')
  `.execute(db);
  await sql`
    CREATE TRIGGER payroll_payments_ledger AFTER INSERT OR UPDATE OR DELETE ON payroll_payments
    FOR EACH ROW EXECUTE FUNCTION ledger_enqueue('payroll_payments', 'id')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS payroll_payments_ledger ON payroll_payments`.execute(db);
  await sql`DROP TRIGGER IF EXISTS payroll_months_ledger ON payroll_months`.execute(db);
  await sql`ALTER TABLE bank_lines DROP CONSTRAINT IF EXISTS bank_lines_done_kind_check`.execute(db);
  await sql`DELETE FROM bank_lines WHERE done_kind = 'payroll'`.execute(db);
  await sql`
    ALTER TABLE bank_lines ADD CONSTRAINT bank_lines_done_kind_check
    CHECK (done_kind IN ('payment', 'payment_group', 'tab_payment', 'move', 'expense'))
  `.execute(db);
  await sql`DROP TABLE IF EXISTS leave_entries`.execute(db);
  await sql`DROP TABLE IF EXISTS payroll_payment_lines`.execute(db);
  await sql`DROP TABLE IF EXISTS payroll_payments`.execute(db);
  await sql`DROP TABLE IF EXISTS payroll_lines`.execute(db);
  await sql`DROP TABLE IF EXISTS payroll_months`.execute(db);
  await sql`DROP TABLE IF EXISTS employees`.execute(db);
  await sql`DELETE FROM ledger_links WHERE key IN ('employer_pension', 'wages_payable', 'pension_payable_employer', 'pension_payable_employee', 'wage_tax_payable')`.execute(db);
}
