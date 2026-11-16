import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

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
const range = () => ({ startDate: today(), endDate: today() });
const switchOn = () => api().put('/api/settings/rules').set(auth()).send({ features: { projects: true } });

describe('projects', () => {
  it('stays off until switched on in Settings', async () => {
    const off = await api().post('/api/projects').set(auth()).send({ name: 'Dasma' });
    expect(off.status).toBe(400);
    expect((await api().get('/api/settings/rules').set(auth())).body.data.features).toEqual({ projects: false, recipes: false, serials: false });
    expect((await switchOn()).body.data.features.projects).toBe(true);
    const on = await api().post('/api/projects').set(auth()).send({ name: 'Dasma' });
    expect(on.status).toBe(201);
    expect((await api().post('/api/projects').set(auth()).send({ name: 'dasma' })).status).toBe(409);
    expect((await api().post('/api/projects').set(auth(employeeToken)).send({ name: 'Tjetër' })).status).toBe(403);
  });

  it('adds up income, goods, bills, stock out and write-offs into a profit per project', async () => {
    await switchOn();
    const job = (await api().post('/api/projects').set(auth()).send({ name: 'Rinovimi i lavazhit' })).body.data.id as number;
    const other = (await api().post('/api/projects').set(auth()).send({ name: 'Dasma' })).body.data.id as number;
    const paint = await createTestProduct(context, adminToken, { name: 'Bojë', price: 23.6, costPrice: 10, stock: 20 });

    // Sold on an invoice: €20 without VAT, €10 of goods. Tagged after it was issued.
    const sale = await api().post('/api/sales/basket').set(auth()).send({ items: [{ productId: paint, quantity: 1 }] });
    expect(sale.status).toBe(201);
    const invoiceId = sale.body.data.invoice.id as number;
    expect((await api().put('/api/projects/tag').set(auth()).send({ kind: 'invoice', id: invoiceId, projectId: job })).status).toBe(200);

    // A bill with a cost line (counts) and a product line (counts only when it goes out).
    const bill = await api()
      .post('/api/bills')
      .set(auth())
      .send({ supplierId: null, issuedOn: today(), paidNow: { method: 'cash' }, projectId: job, updateCosts: false, pricesIncludeVat: false, lines: [{ kind: 'cost', category: 'repairs', amount: 50, vatRate: 0 }, { kind: 'product', productId: paint, quantity: 2, unitPrice: 10, vatRate: 0 }] });
    expect(bill.status).toBe(201);
    const expense = await api().post('/api/expenses').set(auth()).send({ day: today(), amount: 5, category: 'cleaning', place: 'shop', projectId: other });
    expect(expense.status).toBe(201);

    const out = await api().post('/api/stock-documents').set(auth()).send({ direction: 'out', reason: 'own_use', day: today(), projectId: job, lines: [{ productId: paint, quantity: 3 }] });
    expect(out.status).toBe(201);
    const writeOff = await api().post('/api/write-offs').set(auth()).send({ productId: paint, quantity: 1, reason: 'damaged', projectId: job });
    expect(writeOff.status).toBe(201);

    const report = (await api().get('/api/projects/profit').set(auth()).query(range())).body.data;
    expect(report).toHaveLength(2);
    const renovation = report.find((row: { projectId: number }) => row.projectId === job);
    expect(renovation).toMatchObject({ income: 20, goodsCost: 10, bills: 50, stockOut: 30, writeOffs: 10, profit: -80 });
    expect(report.find((row: { projectId: number }) => row.projectId === other)).toMatchObject({ bills: 5, profit: -5 });

    const documents = (await api().get(`/api/projects/${job}/documents`).set(auth()).query(range())).body.data;
    expect(documents.map((doc: { kind: string }) => doc.kind).sort()).toEqual(['bill', 'invoice', 'stock_document', 'write_off']);

    // A credit note follows its invoice's project.
    await api().post(`/api/sales/${sale.body.data.sales[0].id}/returns`).set(auth()).send({ quantity: 1, condition: 'resellable', refundAmount: 23.6 });
    const after = (await api().get('/api/projects/profit').set(auth()).query(range())).body.data.find((row: { projectId: number }) => row.projectId === job);
    expect(after).toMatchObject({ income: 0, goodsCost: 0 });

    // Untagging takes it out; a project on documents can't be removed, only closed.
    await api().put('/api/projects/tag').set(auth()).send({ kind: 'stock_document', id: out.body.data.id, projectId: null });
    expect((await api().get('/api/projects/profit').set(auth()).query(range())).body.data.find((row: { projectId: number }) => row.projectId === job).stockOut).toBe(0);
    expect((await api().delete(`/api/projects/${job}`).set(auth())).status).toBe(409);
    const closed = await api().patch(`/api/projects/${job}`).set(auth()).send({ closed: true });
    expect(closed.body.data.closed).toBe(true);
    const onClosed = await api().post('/api/stock-documents').set(auth()).send({ direction: 'out', reason: 'own_use', day: today(), projectId: job, lines: [{ productId: paint, quantity: 1 }] });
    expect(onClosed.status).toBe(400);
  });

  it('never changes the books: a tagged bill posts the same entry', async () => {
    await switchOn();
    const job = (await api().post('/api/projects').set(auth()).send({ name: 'Puna' })).body.data.id as number;
    const bill = await api().post('/api/bills').set(auth()).send({ supplierId: null, issuedOn: today(), paidNow: { method: 'cash' }, lines: [{ kind: 'cost', category: 'repairs', amount: 30 }] });
    const before = await context.db.selectFrom('ledger_entries').select(['id', 'fingerprint']).where('source_key', '=', `bill:${bill.body.data.id}`).execute();
    await api().put('/api/projects/tag').set(auth()).send({ kind: 'bill', id: bill.body.data.id, projectId: job });
    await api().get('/api/books/entries').set(auth());
    const after = await context.db.selectFrom('ledger_entries').select(['id', 'fingerprint']).where('source_key', '=', `bill:${bill.body.data.id}`).execute();
    expect(after).toEqual(before);
  });
});
