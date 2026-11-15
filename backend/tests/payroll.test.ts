import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { earnedDays, leaveBalance, workingDays, yearlyDays } from '../src/services/payroll/leave.js';
import { dueDayOf, grossFromNet, payFromGross, PAYROLL_RULES, rulesFor } from '../src/services/payroll/payrollRules.js';
import { loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

const rules = PAYROLL_RULES[0]!;
const main = { secondary: false, nonResident: false, extraEmployee: 0, extraEmployer: 0 };

describe('wage tax and pension maths', () => {
  it('works out pension, taxable pay, tax band by band and net', () => {
    expect(payFromGross({ ...main, gross: 300 }, rules)).toMatchObject({ employeePension: 15, employerPension: 15, taxable: 285, tax: 2.8, net: 282.2, cost: 315 });
    const mid = payFromGross({ ...main, gross: 500 }, rules);
    expect(mid).toMatchObject({ employeePension: 25, taxable: 475, tax: 18.5, net: 456.5 });
    expect(mid.taxParts).toEqual([
      { base: 250, rate: 0, tax: 0 },
      { base: 200, rate: 8, tax: 16 },
      { base: 25, rate: 10, tax: 2.5 },
    ]);
    expect(payFromGross({ ...main, gross: 1000 }, rules)).toMatchObject({ taxable: 950, tax: 66, net: 884 });
  });

  it('taxes nothing up to €250 taxable and starts each band exactly at its edge', () => {
    // 263.16 less 5% (13.16) is exactly 250.00 taxable.
    expect(payFromGross({ ...main, gross: 263.16 }, rules)).toMatchObject({ taxable: 250, tax: 0, net: 250 });
    expect(payFromGross({ ...main, gross: 263.17 }, rules)).toMatchObject({ taxable: 250.01, tax: 0 });
    // 473.68 less 5% (23.68) is 450.00: the whole 8% band and nothing at 10%.
    expect(payFromGross({ ...main, gross: 473.68 }, rules)).toMatchObject({ taxable: 450, tax: 16 });
    expect(payFromGross({ ...main, gross: 0 }, rules)).toMatchObject({ tax: 0, net: 0 });
  });

  it('taxes a second job at a flat 10% and skips the pension for a non-resident', () => {
    expect(payFromGross({ ...main, secondary: true, gross: 1000 }, rules)).toMatchObject({ employeePension: 50, taxable: 950, tax: 95, net: 855 });
    expect(payFromGross({ ...main, nonResident: true, gross: 1000 }, rules)).toMatchObject({ employeePension: 0, employerPension: 0, taxable: 1000, tax: 71, net: 929, cost: 1000 });
  });

  it('adds a voluntary extra pension on each side, capped at 15%', () => {
    expect(payFromGross({ ...main, extraEmployee: 5, extraEmployer: 2, gross: 1000 }, rules)).toMatchObject({ employeeRate: 10, employerRate: 7, employeePension: 100, employerPension: 70, taxable: 900, tax: 61, net: 839 });
    expect(payFromGross({ ...main, extraEmployee: 30, gross: 1000 }, rules).employeeRate).toBe(15);
  });

  it('works an agreed net back to the gross that pays it, to the cent', () => {
    expect(grossFromNet(282.2, main, rules)).toBe(300);
    expect(grossFromNet(456.5, main, rules)).toBe(500);
    expect(grossFromNet(250, main, rules)).toBe(263.16);
    let exact = 0;
    let checked = 0;
    for (let cents = 10_000; cents <= 300_000; cents += 37) {
      const net = cents / 100;
      for (const input of [main, { ...main, secondary: true }, { ...main, nonResident: true }]) {
        const back = payFromGross({ ...input, gross: grossFromNet(net, input, rules) }, rules).net;
        expect(back).toBeGreaterThanOrEqual(net);
        expect(back).toBeLessThanOrEqual(net + 0.01);
        checked += 1;
        if (back === net) exact += 1;
      }
    }
    // A cent is out of reach only now and then, from rounding each part.
    expect(exact / checked).toBeGreaterThan(0.85);
  });

  it('knows the rules from September 2024 and the 15th of the next month', () => {
    expect(rulesFor('2024-08-01')).toBeNull();
    expect(rulesFor('2026-11-01')).toBe(rules);
    expect(dueDayOf('2026-12-01', rules)).toBe('2027-01-15');
    expect(dueDayOf('2026-10-01', rules)).toBe('2026-11-15');
  });
});

describe('annual leave maths', () => {
  it('earns a twelfth of the year for each whole month worked', () => {
    expect(earnedDays(20, '2026-01-01', null, '2026-12-31')).toBe(20);
    expect(earnedDays(20, '2026-01-01', null, '2026-06-30')).toBe(10);
    expect(earnedDays(20, '2026-01-15', null, '2026-02-14')).toBe(1.7);
    expect(earnedDays(20, '2026-01-15', null, '2026-02-13')).toBe(0);
    // A leaver earns up to their last day.
    expect(earnedDays(20, '2026-01-01', '2026-03-31', '2026-12-31')).toBe(5);
  });

  it('adds a day for each five full years of service', () => {
    expect(yearlyDays(20, '2020-03-01', '2025-02-28')).toBe(20);
    expect(yearlyDays(20, '2020-03-01', '2025-03-01')).toBe(21);
    expect(yearlyDays(20, '2010-01-01', '2026-01-01')).toBe(23);
  });

  it('gives the balance after leave taken and corrections, and counts weekdays', () => {
    const balance = leaveBalance({ leaveDays: 20, startedOn: '2026-01-01', leftOn: null }, [{ kind: 'taken', days: 5 }, { kind: 'adjust', days: 3 }, { kind: 'adjust', days: -1 }], '2026-12-31');
    expect(balance).toEqual({ yearly: 20, earned: 20, taken: 5, adjusted: 2, balance: 17 });
    expect(workingDays('2026-11-16', '2026-11-22')).toBe(5);
  });
});

describe('payroll in the app', () => {
  let context: TestContext;
  let ownerToken: string;

  beforeAll(async () => {
    context = await setupTestApp();
  });
  beforeEach(async () => {
    await resetData(context.db);
    await seedBooks(context.db as never);
    ownerToken = await loginAs(context, 'owner');
  });
  afterAll(() => context.db.destroy());

  const auth = (token = ownerToken) => ({ Authorization: `Bearer ${token}` });
  const api = () => request(context.app);
  const today = () => new Date().toISOString().slice(0, 10);
  /** Last month, "2026-10". */
  const lastMonth = () => {
    const [year, month] = today().split('-').map(Number) as [number, number];
    return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  };

  const person = (overrides: Record<string, unknown> = {}) => ({
    name: 'Arta Krasniqi',
    personalNumber: '1234567890',
    contract: 'open',
    startedOn: '2025-01-01',
    payBasis: 'gross',
    payAmount: 500,
    bankAccount: '1501 0000 0000 0001',
    ...overrides,
  });

  async function add(overrides: Record<string, unknown> = {}): Promise<number> {
    const response = await api().post('/api/payroll/employees').set(auth()).send(person(overrides));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.data.id;
  }

  async function places() {
    const response = await api().get('/api/money/places').set(auth());
    const list = response.body.data as Array<{ id: number; kind: string; carwashId: number | null; account: { number: string } | null }>;
    return { till: list.find((place) => place.kind === 'till' && place.carwashId === null)!, bank: list.find((place) => place.kind === 'bank') };
  }

  /** Each account's balance from every posted entry, by number. */
  async function balances(): Promise<Record<string, number>> {
    await api().get('/api/books/trial-balance').set(auth());
    const { rows } = await sql<{ number: string; balance: string }>`
      select a.number, sum(l.debit - l.credit)::text as balance from ledger_lines l join ledger_accounts a on a.id = l.account_id group by a.number
    `.execute(context.db);
    return Object.fromEntries(rows.map((row) => [row.number, Number(row.balance)]).filter(([, value]) => value !== 0));
  }

  it('keeps pay to the owner and the accountant', async () => {
    const admin = await loginAs(context, 'admin', { email: 'admin2@test.local' });
    const accountant = await loginAs(context, 'accountant');
    expect((await api().get('/api/payroll/employees').set(auth(admin))).status).toBe(403);
    expect((await api().get('/api/payroll/employees').set(auth(accountant))).status).toBe(200);
    expect((await api().get('/api/payroll/employees').set(auth())).status).toBe(200);
  });

  it('confirms a month into the books, keeps the carwash out of them, and pays wages and ATK', async () => {
    await add();
    await add({ name: 'Besnik Gashi', personalNumber: '1234567891', payBasis: 'net', payAmount: 456.5, place: 'carwash' });
    const month = lastMonth();

    const preview = await api().post(`/api/payroll/run/${month}/preview`).set(auth()).send({});
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.data.lines.map((line: { gross: number }) => line.gross)).toEqual([500, 500]);
    // Gross + employer pension, and what goes to ATK (tax and both pension shares, carwash included).
    expect(preview.body.data.totals).toMatchObject({ gross: 1000, cost: 1050, toAtk: 137, net: 913, carwashGross: 500 });

    const confirmed = await api().post(`/api/payroll/run/${month}`).set(auth()).send({});
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(201);
    const id = confirmed.body.data.id;
    expect(await balances()).toEqual({ '6500': 500, '6520': 25, '2210': -25, '2200': -25, '2310': -18.5, '2100': -456.5 });
    expect((await api().post(`/api/payroll/run/${month}`).set(auth()).send({})).status).toBe(409);

    const { till } = await places();
    const paidOn = today();
    const wages = await api().post(`/api/payroll/months/${id}/pay-wages`).set(auth()).send({ placeId: till.id, paidOn });
    expect(wages.status, JSON.stringify(wages.body)).toBe(201);
    expect(wages.body.data.wagesLeft).toBe(0);
    const atk = await api().post(`/api/payroll/months/${id}/pay-atk`).set(auth()).send({ placeId: till.id, paidOn });
    expect(atk.status, JSON.stringify(atk.body)).toBe(201);
    // Two payments: the wage tax and the pension, so each matches its own bank line.
    expect(atk.body.data.payments.map((payment: { kind: string; amount: number }) => [payment.kind, payment.amount])).toEqual([
      ['wages', 913],
      ['tax', 37],
      ['pension', 100],
    ]);
    const after = await balances();
    // What the shop owed is paid; the carwash staff's part left the books as drawings.
    expect(after['2100'] ?? 0).toBe(0);
    expect(after['2310'] ?? 0).toBe(0);
    expect(after['2200'] ?? 0).toBe(0);
    expect(after['2210'] ?? 0).toBe(0);
    expect(after['3100']).toBe(456.5 + 18.5 + 50);
    expect(after[till.account!.number]).toBe(-(913 + 37 + 100));

    // Undo refuses while anything is paid; take the payments back, then the month.
    expect((await api().post(`/api/payroll/months/${id}/undo`).set(auth())).status).toBe(409);
    for (const payment of atk.body.data.payments) expect((await api().post(`/api/payroll/payments/${payment.id}/undo`).set(auth())).status).toBe(200);
    expect((await api().post(`/api/payroll/months/${id}/undo`).set(auth())).status).toBe(200);
    expect(await balances()).toEqual({});
  });

  it('pays some people now and the rest later, and shows the payments in the place’s book', async () => {
    const first = await add();
    await add({ name: 'Besnik Gashi', personalNumber: '1234567891' });
    const month = lastMonth();
    const id = (await api().post(`/api/payroll/run/${month}`).set(auth()).send({})).body.data.id;
    const { till } = await places();
    const some = await api().post(`/api/payroll/months/${id}/pay-wages`).set(auth()).send({ placeId: till.id, paidOn: today(), employeeIds: [first] });
    expect(some.body.data.unpaid).toHaveLength(1);
    expect(some.body.data.wagesLeft).toBe(456.5);
    const book = await api().get(`/api/money/places/${till.id}/book?from=${lastMonth()}-01&to=${today()}`).set(auth());
    expect(book.status, JSON.stringify(book.body)).toBe(200);
    expect(book.body.data.lines.some((line: { kind: string; amount: number }) => line.kind === 'payroll' && line.amount === -456.5)).toBe(true);
  });

  it('lets a changed gross through with a reason, and warns about the minimum wage and leave still owed', async () => {
    const low = await add({ payAmount: 300 });
    await add({ name: 'Leaving', personalNumber: null, startedOn: '2025-01-01', leftOn: `${lastMonth()}-20` });
    const month = lastMonth();
    const preview = await api()
      .post(`/api/payroll/run/${month}/preview`)
      .set(auth())
      .send({ changes: [{ employeeId: low, gross: 280, reason: 'Two unpaid days' }] });
    const lines = preview.body.data.lines as Array<{ name: string; gross: number; warnings: Array<{ key: string }>; changedReason: string | null }>;
    const arta = lines.find((line) => line.name === 'Arta Krasniqi')!;
    expect(arta).toMatchObject({ gross: 280, changedReason: 'Two unpaid days' });
    expect(arta.warnings.map((warning) => warning.key)).toEqual(['belowMinimum']);
    const leaving = lines.find((line) => line.name === 'Leaving')!;
    expect(leaving.warnings.map((warning) => warning.key).sort()).toEqual(['leaveOwed', 'noPersonalNumber', 'partMonth']);
    expect((await api().post(`/api/payroll/run/${month}/preview`).set(auth()).send({ changes: [{ employeeId: low, gross: 280, reason: '' }] })).status).toBe(400);
  });

  it('refuses a month in a filed VAT month', async () => {
    await add();
    const month = lastMonth();
    await sql`insert into vat_months (month, filed_at, figures) values (${`${month}-01`}::date, now(), '{}'::jsonb)`.execute(context.db);
    expect((await api().post(`/api/payroll/run/${month}`).set(auth()).send({})).status).toBe(409);
  });

  it('records leave and shows each person only their own payslips and leave', async () => {
    const ownToken = await loginAs(context, 'employee', { email: 'arta@test.local' });
    const user = await context.db.selectFrom('users').select('id').where('email', '=', 'arta@test.local').executeTakeFirstOrThrow();
    const staffToken = await loginAs(context, 'employee', { email: 'besa@test.local' });
    const id = await add({ userId: user.id });
    const leave = await api().post(`/api/payroll/employees/${id}/leave`).set(auth()).send({ kind: 'taken', from: '2026-11-16', to: '2026-11-20' });
    expect(leave.status, JSON.stringify(leave.body)).toBe(201);
    expect(leave.body.data.leave.taken).toBe(5);
    expect(leave.body.data.leaveEntries[0].days).toBe(5);
    const monthId = (await api().post(`/api/payroll/run/${lastMonth()}`).set(auth()).send({})).body.data.id;

    // Someone else on the staff sees nothing of it.
    expect((await api().get('/api/payroll/me').set(auth(staffToken))).body.data).toBeNull();
    expect((await api().get(`/api/payroll/months/${monthId}/payslips/${id}`).set(auth(staffToken))).status).toBe(403);
    expect((await api().get('/api/payroll/employees').set(auth(staffToken))).status).toBe(403);

    const mine = await api().get('/api/payroll/me').set(auth(ownToken));
    expect(mine.body.data.payslips).toHaveLength(1);
    const slip = await api().get(`/api/payroll/months/${monthId}/payslips/${id}`).set(auth(ownToken));
    expect(slip.status).toBe(200);
    expect(slip.text).toContain('Paga neto');
    expect(slip.text).toContain('456,50');
  });

  it('downloads the declaration with one row per person', async () => {
    await add();
    const id = (await api().post(`/api/payroll/run/${lastMonth()}`).set(auth()).send({})).body.data.id;
    const csv = await api().get(`/api/payroll/months/${id}/declaration?format=csv`).set(auth());
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('1234567890');
    expect(csv.text).toContain('18.5');
    const xlsx = await api().get(`/api/payroll/months/${id}/declaration`).set(auth());
    expect(xlsx.status).toBe(200);
  });
});
