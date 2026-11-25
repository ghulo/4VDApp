import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { BooksPoster } from '../src/services/books/BooksPoster.js';
import { shopTimeZone } from '../src/validators/operationsValidators.js';
import { createTestProduct, loginAs, resetData, setupTestApp, stockOf, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let employeeToken: string;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  await seedBooks(context.db as never);
  adminToken = await loginAs(context, 'admin');
  employeeToken = await loginAs(context, 'employee');
});
afterAll(() => context.db.destroy());

const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);
const today = () => new Date().toISOString().slice(0, 10);

interface Entry {
  kind: string;
  reversed: boolean;
  lines: Array<{ accountNumber: string; debit: number; credit: number }>;
}
const readLines = (entry: Entry) => entry.lines.map((line) => `${line.accountNumber} ${line.debit > 0 ? `Dr ${line.debit}` : `Cr ${line.credit}`}`).sort();
const entriesFor = async (id: number): Promise<Entry[]> => (await api().get(`/api/books/entries?source=stock_doc&id=${id}`).set(auth())).body.data;
// Stock changes posted on their own, leaving out each product's starting stock (that posts by design).
const adjustmentEntries = async () =>
  (await context.db.selectFrom('ledger_entries').select('id').where('source_key', 'like', 'adjustment:%').where('description', 'not like', 'Starting stock:%').execute()).length;

describe('stock in and out documents', () => {
  it('moves stock, numbers itself and posts one entry at cost for all its lines', async () => {
    const soap = await createTestProduct(context, adminToken, { name: 'Sapun', price: 2, costPrice: 1.2, stock: 10 });
    const oil = await createTestProduct(context, adminToken, { name: 'Vaj', price: 5, costPrice: 3.5, stock: 8, unit: 'l' });
    const noCost = await createTestProduct(context, adminToken, { name: 'Pa kosto', price: 1, costPrice: null, stock: 4 });

    const out = await api()
      .post('/api/stock-documents')
      .set(auth())
      .send({ direction: 'out', reason: 'own_use', day: today(), note: 'Pastrimi i dyqanit', lines: [{ productId: soap, quantity: 3 }, { productId: oil, quantity: 1.5 }, { productId: noCost, quantity: 1 }] });
    expect(out.status).toBe(201);
    expect(out.body.data).toMatchObject({ number: `DA-${today().slice(0, 4)}-000001`, direction: 'out', lineCount: 3, value: 8.85, noCost: 1 });
    expect(await stockOf(context, soap)).toBe(7);
    expect(await stockOf(context, oil)).toBe(6.5);

    const entries = await entriesFor(out.body.data.id);
    expect(entries).toHaveLength(1);
    expect(readLines(entries[0]!)).toEqual(['1340 Cr 8.85', '5400 Dr 8.85']);
    expect(await adjustmentEntries()).toBe(0);

    // A rebuild of the books posts it once again, no more.
    await new BooksPoster(context.db, shopTimeZone()).rebuild();
    expect((await entriesFor(out.body.data.id)).filter((entry) => !entry.reversed && entry.kind === 'auto')).toHaveLength(1);
    expect(await adjustmentEntries()).toBe(0);

    const stockIn = await api().post('/api/stock-documents').set(auth()).send({ direction: 'in', reason: 'found', day: today(), lines: [{ productId: soap, quantity: 2 }] });
    expect(stockIn.body.data.number).toBe(`HY-${today().slice(0, 4)}-000001`);
    expect(readLines((await entriesFor(stockIn.body.data.id))[0]!)).toEqual(['1340 Dr 2.4', '5400 Cr 2.4']);

    const csv = await api().get('/api/exports/stock-documents.csv').set(auth()).query({ startDate: today(), endDate: today() });
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('used in the shop');
    expect(csv.text).toContain('Sapun');
  });

  it('voids: the stock comes back and the entry is reversed', async () => {
    const soap = await createTestProduct(context, adminToken, { name: 'Sapun', price: 2, costPrice: 1, stock: 10 });
    const out = await api().post('/api/stock-documents').set(auth()).send({ direction: 'out', reason: 'given_away', day: today(), lines: [{ productId: soap, quantity: 4 }] });
    expect(await entriesFor(out.body.data.id)).toHaveLength(1);
    const voided = await api().post(`/api/stock-documents/${out.body.data.id}/void`).set(auth());
    expect(voided.status).toBe(200);
    expect(voided.body.data.voidedAt).not.toBeNull();
    expect(await stockOf(context, soap)).toBe(10);
    const entries = await entriesFor(out.body.data.id);
    expect(entries.some((entry) => entry.kind === 'reversal')).toBe(true);
    expect((await api().post(`/api/stock-documents/${out.body.data.id}/void`).set(auth())).status).toBe(409);
  });

  it('refuses what it should', async () => {
    const soap = await createTestProduct(context, adminToken, { name: 'Sapun', price: 2, costPrice: 1, stock: 3 });
    const send = (body: Record<string, unknown>, token = adminToken) => api().post('/api/stock-documents').set(auth(token)).send({ direction: 'out', reason: 'own_use', day: today(), lines: [{ productId: soap, quantity: 1 }], ...body });
    expect((await send({ lines: [{ productId: soap, quantity: 5 }] })).status).toBe(400);
    expect((await send({ lines: [{ productId: soap, quantity: 0.5 }] })).status).toBe(400);
    expect((await send({ reason: 'found' })).status).toBe(400);
    expect((await send({ day: '2999-01-01' })).status).toBe(400);
    expect((await send({}, employeeToken)).status).toBe(403);
    expect(await stockOf(context, soap)).toBe(3);

    const kept = await send({});
    const month = `${today().slice(0, 7)}-01`;
    await context.db.insertInto('vat_months').values({ month, filed_at: new Date(), filed_by: null, figures: JSON.stringify({}), refund: 0 }).execute();
    expect((await send({})).status).toBe(409);
    expect((await api().post(`/api/stock-documents/${kept.body.data.id}/void`).set(auth())).status).toBe(409);
  });
});
