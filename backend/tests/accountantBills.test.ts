import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { createTestProduct, loginAs, resetData, setupTestApp, stockOf, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let accountantToken: string;
let productId: number;
let supplierId: number;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  await seedBooks(context.db as never);
  adminToken = await loginAs(context, 'admin');
  accountantToken = await loginAs(context, 'accountant');
  productId = await createTestProduct(context, adminToken, { price: 100, costPrice: 50, stock: 10, vatRate: 18 });
  supplierId = (await api().post('/api/suppliers').set(as(adminToken)).send({ name: 'Fresh Foods', nui: '811234567' })).body.data.id;
});
afterAll(() => context.db.destroy());

const api = () => request(context.app);
const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const today = () => new Date().toISOString().slice(0, 10);
const send = (body: Record<string, unknown>, token = accountantToken) =>
  api().post('/api/bills').set(as(token)).send({ supplierId, issuedOn: today(), dueOn: null, number: 'AC-1', note: null, ...body });

describe('the accountant adding a supplier bill', () => {
  it('should add a bill of costs or by its total, with its VAT', async () => {
    const costs = await send({ lines: [{ kind: 'cost', category: 'transport', amount: 11.8, vatRate: 18 }] });
    expect(costs.status, JSON.stringify(costs.body)).toBe(201);
    expect(costs.body.data.amount).toBe(11.8);

    const total = await send({ number: 'AC-2', amount: 59, vatAmount: 9 });
    expect(total.status).toBe(201);
    expect(total.body.data).toMatchObject({ amount: 59, vatAmount: 9 });
    expect((await api().post('/api/bills/preview').set(as(accountantToken)).send({ supplierId, issuedOn: today(), dueOn: null, number: null, note: null, lines: [{ kind: 'cost', category: 'transport', amount: 5, vatRate: 18 }] })).status).toBe(200);
  });

  it('should refuse products on the bill (stock and their costs stay with the owner) and new shelf prices', async () => {
    const withProduct = await send({ lines: [{ kind: 'product', productId, quantity: 2, unitPrice: 40 }] });
    expect(withProduct.status).toBe(403);
    expect(withProduct.body.message).toMatch(/Only the owner can add products on a bill/);
    const withPrice = await send({ lines: [{ kind: 'cost', category: 'transport', amount: 5, vatRate: 18 }], prices: [{ productId, price: 120 }] });
    expect(withPrice.status).toBe(403);

    expect(await stockOf(context, productId)).toBe(10);
    expect((await api().get(`/api/products/${productId}`).set(as(adminToken))).body.data.costPrice).toBe(50);
    expect(await context.db.selectFrom('supplier_bills').select('id').execute()).toEqual([]);

    // The owner's side is unchanged: products on a bill go into stock.
    expect((await send({ lines: [{ kind: 'product', productId, quantity: 2, unitPrice: 40 }] }, adminToken)).status).toBe(201);
    expect(await stockOf(context, productId)).toBe(12);
  });

  it('should keep paying, voiding and changing bills with the owner', async () => {
    const { id } = (await send({ amount: 59, vatAmount: 9 })).body.data;
    expect((await api().post(`/api/bills/${id}/void`).set(as(accountantToken)).send({ reason: 'x' })).status).toBe(403);
    expect((await api().post(`/api/bills/${id}/payments`).set(as(accountantToken)).send({ amount: 59, paidOn: today(), method: 'cash' })).status).toBe(403);
  });
});
