import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let ownerToken: string;
let accountantToken: string;
let employeeToken: string;
let productId: number;

// Last year is over, so it can be closed; this year can't.
const LAST = new Date().getUTCFullYear() - 1;
const THIS = LAST + 1;

const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  await seedBooks(context.db as never);
  adminToken = await loginAs(context, 'admin');
  ownerToken = await loginAs(context, 'owner');
  accountantToken = await loginAs(context, 'accountant');
  employeeToken = await loginAs(context, 'employee');
  productId = await createTestProduct(context, adminToken, { price: 100, costPrice: 60, stock: 50, vatRate: 18 });
  await api().put('/api/books/settings').set(auth()).send({ startDay: `${LAST}-01-01` });
});
afterAll(() => context.db.destroy());

/** One sale of €100 (€84.75 + €15.25 VAT) that cost €60: €24.75 profit before tax. */
async function sellOn(day: string) {
  const response = await api().post('/api/sales').set(auth()).send({ productId, quantity: 1, saleDate: `${day}T10:00:00.000Z` });
  expect(response.status).toBe(201);
  return response;
}

const statement = async (kind: string, query: Record<string, string>, token = accountantToken) => {
  const response = await api().get(`/api/books/statements/${kind}`).query(query).set(auth(token));
  expect(response.status).toBe(200);
  return response.body.data;
};
const yearView = async (year: number, token = accountantToken) => {
  const response = await api().get(`/api/books/year/${year}`).set(auth(token));
  expect(response.status).toBe(200);
  return response.body.data;
};
const lineOf = (sections: Array<{ key: string; groups: Array<{ lines: Array<{ number: string | null; key?: string; amount: number }> }> }>, match: (line: { number: string | null; key?: string }) => boolean) =>
  sections.flatMap((section) => section.groups.flatMap((group) => group.lines)).find(match);
const safeId = async () => {
  const places = (await api().get('/api/money/places').set(auth())).body.data as Array<{ id: number; kind: string; isDefault: boolean }>;
  return places.find((place) => place.kind === 'safe' && place.isDefault)!.id;
};

describe('the financial statements', () => {
  it('reads income, balance, cash flow and equity from the books, and they tie out', async () => {
    await sellOn(`${LAST}-03-10`);
    await sellOn(`${LAST}-05-10`);

    const income = await statement('income', { from: `${LAST}-01-01`, to: `${LAST}-12-31`, compareFrom: `${LAST - 1}-01-01`, compareTo: `${LAST - 1}-12-31` });
    expect(income.totals.revenue).toEqual({ amount: 169.5, compare: 0 });
    expect(income.totals.costOfSales.amount).toBe(120);
    expect(income.totals.grossProfit.amount).toBe(49.5);
    expect(income.totals.profitBeforeTax.amount).toBe(49.5);
    expect(income.totals.netProfit.amount).toBe(49.5);
    expect(lineOf(income.sections, (line) => line.number === '4000')?.amount).toBe(169.5);

    const balance = await statement('balance', { from: `${LAST}-01-01`, to: `${LAST}-12-31` });
    expect(balance.balanced).toBe(true);
    // Not closed yet: the profit sits on its own line in equity.
    expect(lineOf(balance.sections, (line) => line.key === 'unclosed_profit')?.amount).toBe(49.5);
    expect(balance.totals.assets.amount).toBe(balance.totals.liabilitiesAndEquity.amount);

    const cash = await statement('cashflow', { from: `${LAST}-01-01`, to: `${LAST}-12-31` });
    expect(cash.balanced).toBe(true);
    expect(cash.totals.net.amount).toBe(200);
    expect(cash.sections.find((section: { key: string }) => section.key === 'operating').amount).toBe(200);
    expect(cash.totals.closing.amount).toBe(200);
    // The goods' cost leaving stock moved no cash: only sales and VAT explain the money in.
    const cashLines = cash.sections.flatMap((section: { groups: Array<{ lines: Array<{ number: string; amount: number }> }> }) => section.groups.flatMap((group) => group.lines));
    expect(cashLines.map((line: { number: string }) => line.number).sort()).toEqual(['2340', '4000']);

    const equity = await statement('equity', { from: `${LAST}-01-01`, to: `${LAST}-12-31` });
    expect(equity.profit).toBe(49.5);
    expect(equity.total.end).toBe(balance.totals.equity.amount);
  });

  it('is for whoever reads the books, and downloads as Excel and as a page to print', async () => {
    await sellOn(`${LAST}-03-10`);
    expect((await api().get('/api/books/statements/income').query({ from: `${LAST}-01-01`, to: `${LAST}-12-31` }).set(auth(employeeToken))).status).toBe(403);
    expect((await api().get('/api/books/statements/nonsense').query({ from: `${LAST}-01-01`, to: `${LAST}-12-31` }).set(auth())).status).toBe(400);

    const xlsx = await api().get('/api/books/statements/balance/download').query({ from: `${LAST}-01-01`, to: `${LAST}-12-31`, lang: 'sq' }).set(auth(ownerToken));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');

    const page = await api().get('/api/books/statements/income/download').query({ from: `${LAST}-01-01`, to: `${LAST}-12-31`, format: 'html', finish: 'bank', lang: 'en' }).set(auth(ownerToken));
    expect(page.status).toBe(200);
    expect(page.text).toContain('Income statement');
    expect(page.text).toContain('Signature and stamp');
    const official = await api().get('/api/books/statements/income/download').query({ from: `${LAST}-01-01`, to: `${LAST}-12-31`, format: 'html', lang: 'sq' }).set(auth(ownerToken));
    expect(official.text).toContain('Pasqyra e të ardhurave');
    expect(official.text).toContain('4000');
  });
});

describe('closing a year', () => {
  it('posts the profit tax and the closing entry, locks the year, and reopens with a reason', async () => {
    for (const day of ['03-10', '05-10', '08-10', '11-10']) await sellOn(`${LAST}-${day}`);

    const before = await yearView(LAST);
    expect(before.close.blockers).toEqual([]);
    expect(before.close.profitBeforeTax).toBe(99);
    expect(before.close.suggestedTax).toBe(9.9);

    // Only the accountant, the owner and the developer close a year.
    expect((await api().post(`/api/books/year/${LAST}/close`).set(auth(adminToken)).send({})).status).toBe(403);
    const closed = await api().post(`/api/books/year/${LAST}/close`).set(auth(accountantToken)).send({});
    expect(closed.status).toBe(200);
    expect(closed.body.data.close.closed).toMatchObject({ profit: 99, tax: 9.9 });

    // The year still shows what it made; the profit now sits in retained earnings.
    const income = await statement('income', { from: `${LAST}-01-01`, to: `${LAST}-12-31` });
    expect(income.totals.profitBeforeTax.amount).toBe(99);
    expect(income.totals.profitTax.amount).toBe(9.9);
    expect(income.totals.netProfit.amount).toBe(89.1);
    const balance = await statement('balance', { from: `${LAST}-01-01`, to: `${LAST}-12-31` });
    expect(balance.balanced).toBe(true);
    expect(lineOf(balance.sections, (line) => line.key === 'unclosed_profit')).toBeUndefined();
    expect(lineOf(balance.sections, (line) => line.number === '3400')?.amount).toBe(89.1);
    expect(lineOf(balance.sections, (line) => line.number === '2350')?.amount).toBe(9.9);
    const equity = await statement('equity', { from: `${LAST}-01-01`, to: `${LAST}-12-31` });
    expect(equity.total.end).toBe(balance.totals.equity.amount);

    // Nothing dated in a closed year can change, and its entries can't be reversed by hand.
    const late = await api().post('/api/sales').set(auth()).send({ productId, quantity: 1, saleDate: `${LAST}-12-20T10:00:00.000Z` });
    expect(late.status).toBe(409);
    expect(late.body.error).toBe('YEAR_CLOSED');
    const closeEntry = closed.body.data.close.closed.closeEntryId;
    expect((await api().post(`/api/books/entries/${closeEntry}/reverse`).set(auth(accountantToken))).status).toBe(400);
    expect((await api().post(`/api/books/year/${LAST}/close`).set(auth(accountantToken)).send({})).status).toBe(409);

    expect((await api().post(`/api/books/year/${LAST}/reopen`).set(auth(accountantToken)).send({ reason: '' })).status).toBe(400);
    const reopened = await api().post(`/api/books/year/${LAST}/reopen`).set(auth(ownerToken)).send({ reason: 'A bill came late' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.close.closed).toBeNull();
    await sellOn(`${LAST}-12-20`);
    const after = await statement('balance', { from: `${LAST}-01-01`, to: `${LAST}-12-31` });
    expect(lineOf(after.sections, (line) => line.key === 'unclosed_profit')?.amount).toBe(123.75);
    expect(lineOf(after.sections, (line) => line.number === '3400')).toBeUndefined();
  });

  it('closes only a year that is over, in order, with the tax the accountant settles on', async () => {
    await sellOn(`${LAST}-03-10`);
    expect((await yearView(THIS)).close.blockers).toContain('not_over');
    expect((await api().post(`/api/books/year/${THIS}/close`).set(auth(accountantToken)).send({})).status).toBe(400);

    const closed = await api().post(`/api/books/year/${LAST}/close`).set(auth(accountantToken)).send({ tax: 0 });
    expect(closed.status).toBe(200);
    expect(closed.body.data.close.closed.taxEntryId).toBeNull();
    const income = await statement('income', { from: `${LAST}-01-01`, to: `${LAST}-12-31` });
    expect(income.totals.netProfit.amount).toBe(24.75);
  });
});

describe('quarterly profit tax (TM)', () => {
  it('suggests each quarter from the profit so far, records a payment from the safe and takes it back', async () => {
    await sellOn(`${LAST}-02-10`);
    await sellOn(`${LAST}-02-11`);
    await sellOn(`${LAST}-05-10`);

    const view = await yearView(LAST);
    expect(view.rate).toBe(0.1);
    const [q1, q2, q3] = view.quarters;
    expect(q1).toMatchObject({ status: 'late', profit: 49.5, tax: 4.95, suggested: 4.95, due: `${LAST}-04-15` });
    expect(q2).toMatchObject({ profit: 74.25, tax: 7.43, suggested: 2.48 });
    // Nothing earned after Q2: Q3 has nothing more to pay.
    expect(q3.status).toBe('nothing');

    // The unpaid quarters are a To do for whoever reads the books.
    const todo = (await api().get('/api/attention').set(auth(accountantToken))).body.data.todo as Array<{ kind: string; key: string }>;
    expect(todo.filter((item) => item.kind === 'tm_due').map((item) => item.key)).toEqual(expect.arrayContaining([`tm_due:${LAST}-1`, `tm_due:${LAST}-2`]));

    const safe = await safeId();
    expect((await api().post(`/api/books/year/${LAST}/instalments`).set(auth(employeeToken)).send({ quarter: 1, amount: 4.95, day: `${LAST}-04-14`, placeId: safe })).status).toBe(403);
    const paid = await api().post(`/api/books/year/${LAST}/instalments`).set(auth(accountantToken)).send({ quarter: 1, amount: 4.95, day: `${LAST}-04-14`, placeId: safe });
    expect(paid.status).toBe(201);
    const [paidQ1, nextQ2] = paid.body.data.quarters;
    expect(paidQ1.status).toBe('paid');
    expect(paidQ1.instalment).toMatchObject({ amount: 4.95, paidOn: `${LAST}-04-14`, place: { id: safe } });
    expect(nextQ2).toMatchObject({ paidBefore: 4.95, suggested: 2.48 });
    expect((await api().post(`/api/books/year/${LAST}/instalments`).set(auth(accountantToken)).send({ quarter: 1, amount: 1, day: `${LAST}-04-14`, placeId: safe })).status).toBe(409);

    // It debits what is owed on profit tax and comes out of the safe.
    const balance = await statement('balance', { from: `${LAST}-01-01`, to: `${LAST}-04-30` });
    expect(lineOf(balance.sections, (line) => line.number === '2350')?.amount).toBe(-4.95);
    expect(balance.balanced).toBe(true);

    const undone = await api().delete(`/api/books/instalments/${paidQ1.instalment.id}`).set(auth(accountantToken));
    expect(undone.status).toBe(200);
    expect(undone.body.data.quarters[0].status).toBe('late');
    const after = await statement('balance', { from: `${LAST}-01-01`, to: `${LAST}-04-30` });
    expect(lineOf(after.sections, (line) => line.number === '2350')).toBeUndefined();
  });

  it("follows last year's tax once there is one: each quarter a quarter of 110% of it (Law 06/L-105)", async () => {
    await sellOn(`${LAST}-02-10`);
    expect((await yearView(LAST)).method).toBe('estimate');

    // Last year's tax from the annual return, and profit made before the books start (still in TREFIN).
    expect((await api().put(`/api/books/year/${LAST}/inputs`).set(auth(employeeToken)).send({ previousTax: 100, profitBefore: 500 })).status).toBe(403);
    const saved = await api().put(`/api/books/year/${LAST}/inputs`).set(auth(accountantToken)).send({ previousTax: 100, profitBefore: 500 });
    expect(saved.status).toBe(200);
    const view = saved.body.data;
    expect(view).toMatchObject({ method: 'last_year', previousTax: 100, previousTaxSource: 'typed', share: 27.5, profitBefore: 500 });
    expect(view.quarters.map((quarter: { suggested: number }) => quarter.suggested)).toEqual([27.5, 27.5, 27.5, 27.5]);
    // The year-end tax counts the whole year: €24.75 in the books plus €500 before them.
    expect(view.close).toMatchObject({ booksProfit: 24.75, profitBeforeTax: 524.75, suggestedTax: 52.48, finalDue: `${THIS}-03-31` });

    // A year with a loss pays nothing on last year's tax: back to the estimate.
    const loss = await api().put(`/api/books/year/${LAST}/inputs`).set(auth(accountantToken)).send({ previousTax: 0, profitBefore: null });
    expect(loss.body.data).toMatchObject({ method: 'estimate', share: null, profitBefore: 0 });

    // Once a year is closed in 4VD, the next follows its tax by itself.
    await api().post(`/api/books/year/${LAST}/close`).set(auth(accountantToken)).send({ tax: 40 });
    expect(await yearView(THIS)).toMatchObject({ method: 'last_year', previousTax: 40, previousTaxSource: 'closed', share: 11 });
    expect((await api().put(`/api/books/year/${LAST}/inputs`).set(auth(accountantToken)).send({ previousTax: 1, profitBefore: null })).status).toBe(409);
  });

  it('sets the instalments against the year-end tax when the year closes', async () => {
    await sellOn(`${LAST}-02-10`);
    const safe = await safeId();
    await api().post(`/api/books/year/${LAST}/instalments`).set(auth(accountantToken)).send({ quarter: 1, amount: 2.48, day: `${LAST}-04-14`, placeId: safe });
    await api().post(`/api/books/year/${LAST}/close`).set(auth(accountantToken)).send({});
    const balance = await statement('balance', { from: `${LAST}-01-01`, to: `${LAST}-12-31` });
    // Tax 2.48 owed, 2.48 paid in advance: nothing left on 2350.
    expect(lineOf(balance.sections, (line) => line.number === '2350')).toBeUndefined();
    expect(balance.balanced).toBe(true);
  });
});
