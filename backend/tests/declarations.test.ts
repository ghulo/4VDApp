import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let accountantToken: string;
let ownerToken: string;
let employeeToken: string;
let productId: number;

// Last year is over, so its declaration can be filed.
const LAST = new Date().getUTCFullYear() - 1;
const THIS = LAST + 1;
const today = new Date().toISOString().slice(0, 10);

const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  await seedBooks(context.db as never);
  adminToken = await loginAs(context, 'admin');
  accountantToken = await loginAs(context, 'accountant');
  ownerToken = await loginAs(context, 'owner');
  employeeToken = await loginAs(context, 'employee');
  productId = await createTestProduct(context, adminToken, { price: 100, costPrice: 60, stock: 50, vatRate: 18 });
  await api().put('/api/books/settings').set(auth()).send({ startDay: `${LAST}-01-01` });
});
afterAll(() => context.db.destroy());

/** One sale of €100 (€84.75 + €15.25 VAT) that cost €60: €24.75 profit. */
async function sellOn(day: string) {
  expect((await api().post('/api/sales').set(auth()).send({ productId, quantity: 1, saleDate: `${day}T10:00:00.000Z` })).status).toBe(201);
}

const declaration = async (year = LAST, token = accountantToken) => {
  const response = await api().get(`/api/books/declaration/${year}`).set(auth(token));
  expect(response.status).toBe(200);
  return response.body.data;
};
const inputs = { includeCarwash: true, representation: null as number | null, donations: null as number | null, fines: 0, other: [] as Array<{ label: string; amount: number }>, earlierLosses: [] as Array<{ year: number; amount: number }> };
const saveInputs = (changes: Partial<typeof inputs>, year = LAST) => api().put(`/api/books/declaration/${year}/inputs`).set(auth(accountantToken)).send({ ...inputs, ...changes });
const safeId = async () => {
  const places = (await api().get('/api/money/places').set(auth())).body.data as Array<{ id: number; kind: string; isDefault: boolean }>;
  return places.find((place) => place.kind === 'safe' && place.isDefault)!.id;
};
const accountId = async (number: string) => (await context.db.selectFrom('ledger_accounts').select('id').where('number', '=', number).executeTakeFirstOrThrow()).id;

describe('the yearly declaration (CD / PD)', () => {
  it('reads the CD from the books, adds the carwash kept outside them, and takes it out with the switch', async () => {
    await sellOn(`${LAST}-03-10`);
    await sellOn(`${LAST}-05-10`);
    expect((await api().put(`/api/carwash/${LAST}-06-01`).set(auth()).send({ carwash: 100, change: 20 })).status).toBe(200);

    const cd = await declaration();
    expect(cd.form).toBe('CD');
    expect(cd.due).toBe(`${THIS}-03-31`);
    expect(cd.status).toBe(today > `${THIS}-03-31` ? 'late' : 'to_file');
    const income = Object.fromEntries(cd.income.lines.map((line: { key: string; amount: number }) => [line.key, line.amount]));
    expect(income).toMatchObject({ sales: 169.5, carwash_takings: 120 });
    expect(cd.costs.lines.find((line: { key: string }) => line.key === 'cost_of_goods').amount).toBe(120);
    expect(cd.carwash).toMatchObject({ included: true, takings: 120, wages: 0, bills: 0 });
    expect(cd.bookProfit).toBe(169.5);
    expect(cd.taxable).toBe(169.5);
    expect(cd.tax).toBe(16.95);

    expect((await api().put(`/api/books/declaration/${LAST}/inputs`).set(auth(employeeToken)).send(inputs)).status).toBe(403);
    const off = await saveInputs({ includeCarwash: false });
    expect(off.status).toBe(200);
    expect((await context.db.selectFrom('activity_log').select('summary').where('action', '=', 'books.declaration_inputs_changed').execute()).map((row) => row.summary)).toEqual([`Changed the figures typed into the ${LAST} profit tax declaration`]);
    expect(off.body.data.income.lines.some((line: { key: string }) => line.key === 'carwash_takings')).toBe(false);
    expect(off.body.data.tax).toBe(4.95);
  });

  it('adds back what is not deductible and carries losses forward for six years', async () => {
    await sellOn(`${LAST}-03-10`);
    await sellOn(`${LAST}-05-10`);
    // €30 of representation: only 2% of €169.50 income (€3.39) is allowed.
    const entry = await api()
      .post('/api/books/entries')
      .set(auth())
      .send({ date: `${LAST}-06-01`, description: 'Dinner with a supplier', lines: [{ accountId: await accountId('6020'), debit: 30 }, { accountId: await accountId('1111'), credit: 30 }] });
    expect(entry.status).toBe(201);

    const cd = await declaration();
    expect(cd.bookProfit).toBe(19.5);
    expect(cd.adjustments[0]).toMatchObject({ key: 'representation', spent: 30, allowed: 3.39, suggested: 26.61, amount: 26.61, overridden: false });
    expect(cd.adjustedProfit).toBe(46.11);

    // The accountant's own figure, a fine and a loss from a TREFIN year.
    expect((await saveInputs({ earlierLosses: [{ year: LAST - 7, amount: 50 }] })).status).toBe(400);
    const saved = await saveInputs({ representation: 10, fines: 20, other: [{ label: 'Private car costs', amount: 5 }], earlierLosses: [{ year: LAST - 1, amount: 30 }] });
    expect(saved.status).toBe(200);
    const data = saved.body.data;
    expect(data.adjustments.map((line: { key: string; amount: number }) => [line.key, line.amount])).toEqual([
      ['representation', 10],
      ['donations', 0],
      ['fines', 20],
      ['other', 5],
    ]);
    expect(data.adjustedProfit).toBe(54.5);
    expect(data.losses).toEqual([{ year: LAST - 1, amount: 30, source: 'typed', usedBefore: 0, used: 30 }]);
    expect(data.taxable).toBe(24.5);
    expect(data.tax).toBe(2.45);
  });

  it('subtracts the instalments of the year, pays the rest, files, locks and reopens with a reason', async () => {
    await sellOn(`${LAST}-03-10`);
    await saveInputs({ other: [{ label: 'Profit kept in TREFIN', amount: 975.25 }] });
    // €24.75 + €975.25 = €1,000 taxable: €100 tax.
    const safe = await safeId();
    expect((await api().post(`/api/books/year/${LAST}/instalments`).set(auth(accountantToken)).send({ quarter: 1, amount: 30, day: `${LAST}-04-14`, placeId: safe })).status).toBe(201);
    // Q4 is paid in January but belongs to last year.
    expect((await api().post(`/api/books/year/${LAST}/instalments`).set(auth(accountantToken)).send({ quarter: 4, amount: 20, day: `${THIS}-01-10`, placeId: safe })).status).toBe(201);

    let cd = await declaration();
    expect(cd.tax).toBe(100);
    expect(cd.instalments.map((item: { quarter: number; amount: number }) => [item.quarter, item.amount])).toEqual([
      [1, 30],
      [4, 20],
    ]);
    expect(cd.instalmentsTotal).toBe(50);
    expect(cd.left).toBe(50);

    // The rest is paid with the declaration, never inside the year itself.
    expect((await api().post(`/api/books/declaration/${LAST}/pay`).set(auth(accountantToken)).send({ amount: 50, day: `${LAST}-12-30`, placeId: safe })).status).toBe(400);
    const paid = await api().post(`/api/books/declaration/${LAST}/pay`).set(auth(accountantToken)).send({ amount: 50, day: `${THIS}-01-20`, placeId: safe });
    expect(paid.status).toBe(201);
    expect(paid.body.data.restPayment).toMatchObject({ amount: 50, paidOn: `${THIS}-01-20` });
    expect(paid.body.data.left).toBe(0);
    // The year page's quarters don't count it as a TM.
    const year = (await api().get(`/api/books/year/${LAST}`).set(auth(accountantToken))).body.data;
    expect(year.paid).toBe(50);

    // To do until it is marked as filed.
    const todo = async () => ((await api().get('/api/attention').set(auth(accountantToken))).body.data.todo as Array<{ key: string }>).map((item) => item.key);
    expect(await todo()).toContain(`declaration_due:${LAST}`);

    expect((await api().post(`/api/books/declaration/${LAST}/file`).set(auth(accountantToken)).send({ day: `${LAST}-12-31` })).status).toBe(400);
    const filed = await api().post(`/api/books/declaration/${LAST}/file`).set(auth(accountantToken)).send({ day: `${THIS}-01-25` });
    expect(filed.status).toBe(200);
    expect(filed.body.data).toMatchObject({ status: 'filed', filed: { on: `${THIS}-01-25` }, tax: 100, changedSinceFiled: false });
    expect(await todo()).not.toContain(`declaration_due:${LAST}`);
    expect((await saveInputs({})).status).toBe(409);

    // The books move after filing: the filed figures stay, and the change is flagged.
    await sellOn(`${LAST}-06-10`);
    cd = await declaration();
    expect(cd.tax).toBe(100);
    expect(cd.changedSinceFiled).toBe(true);
    expect(cd.liveTax).toBe(102.48);

    expect((await api().post(`/api/books/declaration/${LAST}/reopen`).set(auth(accountantToken)).send({ reason: '' })).status).toBe(400);
    const reopened = await api().post(`/api/books/declaration/${LAST}/reopen`).set(auth(accountantToken)).send({ reason: 'Late bill' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data).toMatchObject({ filed: null, tax: 102.48 });
  });

  it('counts the carwash staff and the carwash bills as its costs', async () => {
    await sellOn(`${LAST}-03-10`);
    // A carwash bill paid on the spot (an expense), outside the books.
    const carwashId = (await context.db.selectFrom('carwashes').select('id').executeTakeFirstOrThrow()).id;
    const expense = await api().post('/api/expenses').set(auth()).send({ day: `${LAST}-06-02`, amount: 40, category: 'water', place: 'carwash', carwashId });
    expect(expense.status, JSON.stringify(expense.body)).toBe(201);
    // A carwash worker on €500 gross: €525 with the employer's pension.
    const person = await api().post('/api/payroll/employees').set(auth(ownerToken)).send({ name: 'Besnik Gashi', personalNumber: '1234567891', contract: 'open', startedOn: `${LAST}-01-01`, payBasis: 'gross', payAmount: 500, bankAccount: '1501 0000 0000 0001', place: 'carwash' });
    expect(person.status, JSON.stringify(person.body)).toBe(201);
    const run = await api().post(`/api/payroll/run/${LAST}-12`).set(auth(ownerToken)).send({});
    expect(run.status, JSON.stringify(run.body)).toBe(201);

    const cd = await declaration();
    expect(cd.carwash).toMatchObject({ included: true, takings: 0, wages: 525, bills: 40 });
    expect(cd.costs.lines.find((line: { key: string }) => line.key === 'carwash_costs').amount).toBe(565);
    // The books hold only the shop: the sale's €24.75 profit, less the carwash.
    expect(cd.bookProfit).toBe(-540.25);
    expect(cd.tax).toBe(0);
  });

  it('files the PD for an individual business on the personal bands, and the year page follows', async () => {
    await sellOn(`${LAST}-03-10`);
    expect((await api().put('/api/business').set(auth()).send({ legalForm: 'individual' })).status).toBe(200);
    // €24.75 + €5,000 = €5,024.75: 0% up to €3,000, 8% on the next €2,024.75.
    const pd = (await saveInputs({ other: [{ label: 'Profit kept in TREFIN', amount: 5000 }] })).body.data;
    expect(pd.form).toBe('PD');
    expect(pd.taxParts.map((part: { from: number; to: number | null; rate: number; tax: number }) => [part.from, part.to, part.rate, part.tax])).toEqual([
      [0, 3000, 0, 0],
      [3000, 5400, 8, 161.98],
      [5400, null, 10, 0],
    ]);
    expect(pd.tax).toBe(161.98);
    // The carwash belongs to the company: a PD has no carwash lines, whatever the switch says.
    expect(pd.carwash.included).toBe(false);
    expect(pd.income.lines.some((line: { key: string }) => line.key === 'carwash_takings')).toBe(false);
    expect((await api().get(`/api/books/year/${LAST}`).set(auth(accountantToken))).body.data.form).toBe('PD');
  });

  it('is read with the books and downloads as Excel and as a page to print', async () => {
    await sellOn(`${LAST}-03-10`);
    expect((await api().get(`/api/books/declaration/${LAST}`).set(auth(employeeToken))).status).toBe(403);
    const xlsx = await api().get(`/api/books/declaration/${LAST}/download`).query({ lang: 'en' }).set(auth(accountantToken));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const page = await api().get(`/api/books/declaration/${LAST}/download`).query({ lang: 'sq', format: 'html' }).set(auth(accountantToken));
    expect(page.status).toBe(200);
    expect(page.text).toContain('(CD)');
    expect(page.text).toContain('Fitimi i tatueshëm');
  });
});
