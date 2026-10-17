import request from 'supertest';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let ownerToken: string;
let accountantToken: string;
let employeeToken: string;
let productId: number;
let supplierId: number;

/** "2026-08" for `back` months before this one. */
function monthKey(back: number): string {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - back);
  return date.toISOString().slice(0, 7);
}
const EARLIER = monthKey(2);
const LAST = monthKey(1);
const THIS = monthKey(0);

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
  supplierId = (await api().post('/api/suppliers').set(auth()).send({ name: 'Fresh Foods', nui: '811234567' })).body.data.id;
  await api().put('/api/books/settings').set(auth()).send({ startDay: `${EARLIER}-01` });
});
afterAll(() => context.db.destroy());

async function sellOn(day: string, id = productId): Promise<number> {
  const response = await api().post('/api/sales').set(auth()).send({ productId: id, quantity: 1, saleDate: `${day}T10:00:00.000Z` });
  expect(response.status).toBe(201);
  return response.body.data.id;
}
async function billOn(day: string, body: Record<string, unknown> = {}) {
  return api().post('/api/bills').set(auth()).send({ supplierId, number: `FF-${day}`, issuedOn: day, amount: 118, vatAmount: 18, ...body });
}
const vatMonth = async (month: string, token = accountantToken) => {
  const response = await api().get(`/api/vat/${month}`).set(auth(token));
  expect(response.status).toBe(200);
  return response.body.data;
};

describe('the VAT return', () => {
  it('works out the boxes from sales and bills, and carries a credit to the next month', async () => {
    await sellOn(`${EARLIER}-10`);
    await billOn(`${EARLIER}-12`);

    const earlier = await vatMonth(EARLIER);
    expect(earlier.boxes[12]).toBe(84.75);
    expect(earlier.boxes[13]).toBe(15.25);
    expect(earlier.boxes[43]).toBe(100);
    expect(earlier.boxes[44]).toBe(18);
    expect(earlier.boxes[30]).toBe(15.25);
    expect(earlier.boxes[67]).toBe(18);
    expect(earlier.boxes[71]).toBe(2.75);
    expect(earlier.outcome).toBe('carry');
    // Till sales are one line per day.
    expect(earlier.items.filter((item: { kind: string }) => item.kind === 'till_day')).toHaveLength(1);

    const last = await vatMonth(LAST);
    expect(last.boxes[68]).toBe(2.75);
    expect(last.carriedFrom).toBe('previous');
  });

  it('puts the 16% rate with 18% and exempt sales in box 9', async () => {
    const old = await createTestProduct(context, adminToken, { name: 'Old rate', price: 116, costPrice: 50, stock: 5, vatRate: 16 });
    const exempt = await createTestProduct(context, adminToken, { name: 'Bread', price: 10, costPrice: 5, stock: 5, vatRate: 0, vatExempt: true });
    await sellOn(`${LAST}-05`, old);
    await sellOn(`${LAST}-05`, exempt);
    const month = await vatMonth(LAST);
    expect(month.boxes[12]).toBe(100);
    expect(month.boxes[13]).toBe(16);
    expect(month.boxes[9]).toBe(10);
    expect(month.boxes[10]).toBe(0);
  });

  it('keeps a product with a rate from being exempt', async () => {
    const id = await createTestProduct(context, adminToken, { name: 'Wrong', price: 10, costPrice: 5, stock: 1, vatRate: 18, vatExempt: true });
    expect((await api().get(`/api/products/${id}`).set(auth())).body.data).toMatchObject({ vatRate: 18, vatExempt: false });
  });

  it('downloads the sales and purchase books, the EDI file and the printed page', async () => {
    await sellOn(`${LAST}-10`);
    await billOn(`${LAST}-12`);
    const xlsx = await api().get(`/api/vat/${LAST}/books/sales?format=xlsx`).set(auth(accountantToken));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const edi = await api().get(`/api/vat/${LAST}/books/purchases?format=edi`).set(auth(accountantToken));
    expect(edi.status).toBe(200);
    expect(edi.text).toContain('[43]');
    expect(edi.text).toContain('811234567');
    const page = await api().get(`/api/vat/${LAST}/books/sales?format=html&lang=en`).set(auth(accountantToken));
    expect(page.text).toContain('Sales book');
    expect(page.text).toContain('Till sales (1)');
  });

  it('lists checks before filing: a bill from a supplier with no NUI', async () => {
    // Suppliers from before NUIs were asked for can still have none.
    const { id: noNui } = await context.db.insertInto('suppliers').values({ name: 'No Papers' }).returning('id').executeTakeFirstOrThrow();
    await billOn(`${LAST}-03`, { supplierId: noNui });
    const month = await vatMonth(LAST);
    expect(month.checks.map((check: { kind: string }) => check.kind)).toContain('no_nui');
  });
});

describe('filing a month', () => {
  it('locks everything dated in it, and counts a late bill in the next open month', async () => {
    await sellOn(`${EARLIER}-10`);
    const bill = (await billOn(`${EARLIER}-12`)).body.data;

    const filed = await api().post(`/api/vat/${EARLIER}/file`).set(auth(accountantToken));
    expect(filed.status).toBe(200);
    expect(filed.body.data.status).toBe('filed');
    expect((await api().get('/api/vat/filed').set(auth())).body.data).toEqual([EARLIER]);

    const sale = await api().post('/api/sales').set(auth()).send({ productId, quantity: 1, saleDate: `${EARLIER}-11T10:00:00.000Z` });
    expect(sale.status).toBe(409);
    expect(sale.body.error).toBe('PERIOD_FILED');

    const expense = await api().post('/api/expenses').set(auth()).send({ day: `${EARLIER}-15`, amount: 30, category: 'rent', place: 'shop' });
    expect(expense.status).toBe(409);

    const accounts = (await api().get('/api/books/accounts').set(auth())).body.data as Array<{ id: number; number: string }>;
    const cash = accounts.find((account) => account.number === '1110')!;
    const rent = accounts.find((account) => account.number.startsWith('6'))!;
    const entry = await api()
      .post('/api/books/entries')
      .set(auth(accountantToken))
      .send({ date: `${EARLIER}-20`, description: 'Fix', lines: [{ accountId: rent.id, debit: 10 }, { accountId: cash.id, credit: 10 }] });
    expect(entry.status).toBe(409);

    expect((await api().put(`/api/bills/${bill.id}`).set(auth()).send({ number: 'FF-X', issuedOn: `${EARLIER}-12`, dueOn: null, amount: 118, note: null })).status).toBe(409);
    expect((await api().post(`/api/bills/${bill.id}/void`).set(auth()).send({ note: 'wrong' })).status).toBe(409);

    // A bill that arrives late is not refused: it counts in the next open month and says so.
    const late = await billOn(`${EARLIER}-25`, { number: 'FF-LATE' });
    expect(late.status).toBe(201);
    expect(late.body.data.vatMonth).toBe(LAST);
    const last = await vatMonth(LAST);
    expect(last.items.find((item: { number: string }) => item.number === 'FF-LATE')).toMatchObject({ lateFrom: EARLIER });
    const earlier = await vatMonth(EARLIER);
    expect(earlier.items.some((item: { number: string }) => item.number === 'FF-LATE')).toBe(false);

    // Something in an open month still goes through.
    expect((await api().post('/api/sales').set(auth()).send({ productId, quantity: 1 })).status).toBe(201);
  });

  it('refuses undoing a sale or setting a fiscal receipt number in a filed month', async () => {
    await sellOn(`${EARLIER}-10`);
    const { id: entryId } = await context.db.selectFrom('activity_log').select('id').where('action', '=', 'sale.recorded').executeTakeFirstOrThrow();
    const { id: documentId } = await context.db.selectFrom('documents').select('id').executeTakeFirstOrThrow();
    // Documents never change their date in the app, so the test moves it straight in the database.
    await sql`update documents set issued_at = ${`${EARLIER}-10T10:00:00Z`} where id = ${documentId}`.execute(context.db);
    await api().post(`/api/vat/${EARLIER}/file`).set(auth(accountantToken));
    const undo = await api().post(`/api/activity/${entryId}/undo`).set(auth()).send({ note: 'wrong' });
    expect(undo.status).toBe(409);
    expect(undo.body.error).toBe('PERIOD_FILED');
    expect((await api().put(`/api/documents/${documentId}/fiscal-receipt`).set(auth()).send({ fiscalReceiptNo: '123' })).status).toBe(409);
  });

  it('keeps what was filed, and refuses filing a month that is not over or already filed', async () => {
    expect((await api().post(`/api/vat/${THIS}/file`).set(auth(accountantToken))).status).toBe(409);
    expect((await api().post(`/api/vat/${LAST}/file`).set(auth(accountantToken))).status).toBe(200);
    expect((await api().post(`/api/vat/${LAST}/file`).set(auth(accountantToken))).status).toBe(409);
    expect((await api().put(`/api/vat/${LAST}`).set(auth(accountantToken)).send({ refund: 0 })).status).toBe(409);
  });

  it('reopens only for the accountant or the owner, with a reason, and logs it', async () => {
    await api().post(`/api/vat/${LAST}/file`).set(auth(accountantToken));
    expect((await api().post(`/api/vat/${LAST}/reopen`).set(auth(adminToken)).send({ reason: 'A bill was wrong' })).status).toBe(403);
    expect((await api().post(`/api/vat/${LAST}/reopen`).set(auth(ownerToken)).send({ reason: '' })).status).toBe(400);
    const reopened = await api().post(`/api/vat/${LAST}/reopen`).set(auth(ownerToken)).send({ reason: 'A bill was wrong' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.status).toBe('open');

    const log = await context.db.selectFrom('activity_log').select(['action', 'details']).where('action', '=', 'vat.reopened').executeTakeFirstOrThrow();
    expect(log.details).toMatchObject({ reason: 'A bill was wrong' });
    expect((await api().post('/api/expenses').set(auth()).send({ day: `${LAST}-15`, amount: 30, category: 'rent', place: 'shop' })).status).toBe(201);
  });

  it('caps a refund at the credit, and lets box 68 be typed only for the first month', async () => {
    await billOn(`${EARLIER}-12`);
    expect((await api().put(`/api/vat/${EARLIER}`).set(auth(accountantToken)).send({ refund: 50 })).status).toBe(400);
    const saved = await api().put(`/api/vat/${EARLIER}`).set(auth(accountantToken)).send({ refund: 10, carriedIn: 5 });
    expect(saved.status).toBe(200);
    expect(saved.body.data.boxes[68]).toBe(5);
    expect(saved.body.data.boxes[70]).toBe(10);
    expect(saved.body.data.boxes[71]).toBe(13);
    expect((await api().put(`/api/vat/${LAST}`).set(auth(accountantToken)).send({ carriedIn: 5 })).status).toBe(400);
    expect((await vatMonth(LAST)).boxes[68]).toBe(13);
  });

  it('puts the unfiled months in To do until they are filed', async () => {
    const todo = (await api().get('/api/attention').set(auth(accountantToken))).body.data.todo as Array<{ key: string; to: string }>;
    expect(todo.map((item) => item.key)).toEqual(expect.arrayContaining([`vat_due:${EARLIER}`, `vat_due:${LAST}`]));
    await api().post(`/api/vat/${EARLIER}/file`).set(auth(accountantToken));
    const after = (await api().get('/api/attention').set(auth(ownerToken))).body.data.todo as Array<{ key: string }>;
    expect(after.map((item) => item.key)).not.toContain(`vat_due:${EARLIER}`);
    expect(after.map((item) => item.key)).toContain(`vat_due:${LAST}`);
  });
});

describe('the accountant', () => {
  it('reads the money side but cannot sell, change stock or prices, or manage people', async () => {
    for (const path of ['/api/books/journal?from=2000-01-01&to=2100-12-31', '/api/bills', `/api/expenses?startDate=${LAST}-01T00:00:00Z&endDate=${THIS}-01T00:00:00Z`, '/api/documents', '/api/customers', '/api/suppliers', `/api/vat/year/${THIS.slice(0, 4)}`]) {
      const response = await api().get(path).set(auth(accountantToken));
      expect(response.status, path).toBe(200);
    }
    expect((await api().post('/api/sales').set(auth(accountantToken)).send({ productId, quantity: 1 })).status).toBe(403);
    expect((await api().put(`/api/products/${productId}`).set(auth(accountantToken)).send({ price: 1 })).status).toBe(403);
    expect((await api().post('/api/bills').set(auth(accountantToken)).send({ supplierId, issuedOn: `${LAST}-01`, amount: 1 })).status).toBe(403);
    expect((await api().post('/api/invites').set(auth(accountantToken)).send({ email: 'x@test.local', role: 'employee' })).status).toBe(403);
    expect((await api().get(`/api/vat/${LAST}`).set(auth(employeeToken))).status).toBe(403);
  });

  it('asks a question on a bill; it lands in To do, and the answer comes back to the accountant', async () => {
    const bill = (await billOn(`${LAST}-12`)).body.data;
    expect((await api().post(`/api/threads/bill/${bill.id}`).set(auth(adminToken)).send({ body: 'Nothing asked yet' })).status).toBe(400);
    const asked = await api().post(`/api/threads/bill/${bill.id}`).set(auth(accountantToken)).send({ body: 'Is this the right VAT?' });
    expect(asked.status).toBe(201);
    expect(asked.body.data.status).toBe('open');

    const todo = (await api().get('/api/attention').set(auth(ownerToken))).body.data.todo as Array<{ kind: string; to: string }>;
    expect(todo.find((item) => item.kind === 'question')).toMatchObject({ to: `/bills/${bill.id}` });

    const answered = await api().post(`/api/threads/bill/${bill.id}`).set(auth(ownerToken)).send({ body: 'Yes, 18%.' });
    expect(answered.body.data.status).toBe('answered');
    expect(answered.body.data.notes.map((note: { side: string }) => note.side)).toEqual(['question', 'answer']);
    const after = (await api().get('/api/attention').set(auth(ownerToken))).body.data.todo as Array<{ kind: string }>;
    expect(after.some((item) => item.kind === 'question')).toBe(false);

    const notes = await context.db.selectFrom('notifications as n').innerJoin('users as u', 'u.id', 'n.user_id').select(['u.role', 'n.type']).execute();
    expect(notes).toContainEqual({ role: 'accountant', type: 'question_answered' });
  });
});
