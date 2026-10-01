import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestCategory, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let categoryId: number;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
  categoryId = (await createTestCategory(context.db)).id;
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createProduct(overrides: Record<string, unknown> = {}): Promise<number> {
  const response = await request(context.app)
    .post('/api/products')
    .set(auth(adminToken))
    .send({ name: 'Oak Chair', categoryId, price: 100, costPrice: 60, stock: 100, reorderLevel: 10, ...overrides });
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  return response.body.data.id as number;
}

async function sell(token: string, productId: number, quantity: number, saleDate?: string) {
  const response = await request(context.app).post('/api/sales').set(auth(token)).send({ productId, quantity, saleDate });
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  return response.body.data;
}

describe('cost at time of sale', () => {
  it('should keep the original profit when the cost price changes later', async () => {
    const productId = await createProduct();
    await sell(adminToken, productId, 2);

    await request(context.app)
      .put(`/api/products/${productId}`)
      .set(auth(adminToken))
      .send({ name: 'Oak Chair', categoryId, price: 100, costPrice: 90 });
    const dashboard = await request(context.app).get('/api/analytics/dashboard').set(auth(adminToken));
    const sale = await context.db.selectFrom('sales').select('unit_cost').executeTakeFirstOrThrow();

    expect(sale.unit_cost).toBe('60.00');
    expect(dashboard.body.data.totalProfit).toBe(80);
  });

  it('should save no cost when the product has no cost price', async () => {
    const productId = await createProduct({ costPrice: null });
    await sell(adminToken, productId, 1);

    const sale = await context.db.selectFrom('sales').select('unit_cost').executeTakeFirstOrThrow();

    expect(sale.unit_cost).toBeNull();
  });
});
