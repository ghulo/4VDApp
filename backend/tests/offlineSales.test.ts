import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestProduct, createTestUser, resetData, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers/testApp.js';

let context: TestContext;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(() => resetData(context.db));
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signIn(role: 'admin' | 'employee') {
  const user = await createTestUser(context.db, role);
  const response = await request(context.app).post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
  return { id: user.id, token: response.body.data.token as string };
}

const stockOf = async (productId: number) =>
  (await context.db.selectFrom('inventory').select('quantity_on_hand').where('product_id', '=', productId).executeTakeFirstOrThrow()).quantity_on_hand;

describe('Counter sales made offline', () => {
  it('should record a sale sent twice only once, and give the same answer', async () => {
    const admin = await signIn('admin');
    const employee = await signIn('employee');
    const product = await createTestProduct(context, admin.token, { name: 'Vase', price: 20, stock: 10 });
    const key = randomUUID();
    const send = () =>
      request(context.app).post('/api/sales/basket').set(auth(employee.token)).send({ items: [{ productId: product, quantity: 2 }], clientKey: key });

    const first = await send();
    expect(first.status).toBe(201);
    const again = await send();
    expect(again.status).toBe(201);
    expect(again.body.data.invoice).toEqual(first.body.data.invoice);
    expect(again.body.data.sales.map((sale: { id: number }) => sale.id)).toEqual(first.body.data.sales.map((sale: { id: number }) => sale.id));
    expect(await stockOf(product)).toBe(8);
    expect(await context.db.selectFrom('documents').select('id').execute()).toHaveLength(1);

    // Two sends at the same moment still make one sale.
    const both = randomUUID();
    const once = () =>
      request(context.app).post('/api/sales/basket').set(auth(employee.token)).send({ items: [{ productId: product, quantity: 1 }], clientKey: both });
    const [a, b] = await Promise.all([once(), once()]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.data.invoice.id).toBe(b.body.data.invoice.id);
    expect(await stockOf(product)).toBe(7);
  });

  it('should keep the time an offline sale was made', async () => {
    const admin = await signIn('admin');
    const product = await createTestProduct(context, admin.token, { name: 'Vase', price: 20, stock: 10 });
    const soldAt = new Date(Date.now() - 2 * 3600_000).toISOString();
    const sold = await request(context.app)
      .post('/api/sales/basket')
      .set(auth(admin.token))
      .send({ items: [{ productId: product, quantity: 1 }], clientKey: randomUUID(), soldAt });
    expect(sold.status).toBe(201);
    expect(sold.body.data.sales[0].saleDate).toBe(soldAt);

    const noKey = await request(context.app).post('/api/sales/basket').set(auth(admin.token)).send({ items: [{ productId: product, quantity: 1 }], soldAt });
    expect(noKey.status).toBe(400);
    const future = new Date(Date.now() + 3600_000).toISOString();
    const ahead = await request(context.app)
      .post('/api/sales/basket')
      .set(auth(admin.token))
      .send({ items: [{ productId: product, quantity: 1 }], clientKey: randomUUID(), soldAt: future });
    expect(ahead.status).toBe(400);
  });

  it('should take stock to 0 for an offline sale past stock and ask for a count', async () => {
    const admin = await signIn('admin');
    const employee = await signIn('employee');
    const product = await createTestProduct(context, admin.token, { name: 'Vase', price: 20, stock: 2 });
    const basket = (extra: Record<string, unknown>) =>
      request(context.app).post('/api/sales/basket').set(auth(employee.token)).send({ items: [{ productId: product, quantity: 5 }], ...extra });

    // Online, 4VD's stock still decides.
    expect((await basket({})).status).toBe(400);
    const offline = await basket({ clientKey: randomUUID(), soldAt: new Date().toISOString() });
    expect(offline.status).toBe(201);
    expect(offline.body.data.total).toBe(100);
    expect(await stockOf(product)).toBe(0);

    const todo = await request(context.app).get('/api/attention').set(auth(admin.token));
    const item = todo.body.data.todo.find((one: { kind: string }) => one.kind === 'offline_shortfall');
    expect(item).toMatchObject({ title: 'Count Vase', to: `/inventory/${product}`, productId: product });
    expect(item.detail).toContain('3 more');

    // Counted again: the To do clears itself.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await context.db.insertInto('stock_adjustments').values({ product_id: product, adjustment_quantity: 4, reason: 'Recount', notes: null, adjusted_by: admin.id }).execute();
    const after = await request(context.app).get('/api/attention').set(auth(admin.token));
    expect(after.body.data.todo.some((one: { kind: string }) => one.kind === 'offline_shortfall')).toBe(false);
  });
});
