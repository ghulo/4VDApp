import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let employeeToken: string;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
  employeeToken = await loginAs(context, 'employee');
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const today = () => ({
  startDate: new Date(Date.now() - MS_PER_DAY).toISOString(),
  endDate: new Date(Date.now() + 60_000).toISOString(),
});

describe('undone sales in reports', () => {
  it('should leave an undone sale out of every money total, including the seller’s', async () => {
    const productId = await createTestProduct(context, adminToken, { price: 100, stock: 10 });
    const sell = () => request(context.app).post('/api/sales').set(auth(employeeToken)).send({ productId, quantity: 1 });
    const first = await sell();
    await sell();
    await context.db.updateTable('sales').set({ undone_at: new Date() }).where('id', '=', first.body.data.id).execute();

    const summary = await request(context.app).get('/api/reports/summary').query(today()).set(auth(adminToken));
    const team = await request(context.app).get('/api/reports/team').query(today()).set(auth(adminToken));

    expect(summary.body.data.current.revenue).toBe(100);
    expect(team.body.data.find((person: { role: string }) => person.role === 'employee').salesCount).toBe(1);
  });

  it('should refuse to return a sale that was undone', async () => {
    const productId = await createTestProduct(context, adminToken, { price: 100, stock: 10 });
    const sale = await request(context.app).post('/api/sales').set(auth(employeeToken)).send({ productId, quantity: 1 });
    await context.db.updateTable('sales').set({ undone_at: new Date() }).where('id', '=', sale.body.data.id).execute();

    const returned = await request(context.app)
      .post(`/api/sales/${sale.body.data.id}/returns`)
      .set(auth(adminToken))
      .send({ quantity: 1, condition: 'resellable', notes: null });

    expect(returned.status).toBe(409);
  });
});
