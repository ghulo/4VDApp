import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });

async function sell(price: number, quantity: number) {
  const product = await createTestProduct(context, adminToken, { name: `Item ${price}`, price, costPrice: 1, stock: 100 });
  await request(context.app).post('/api/sales').set(auth(adminToken)).send({ productId: product, quantity });
}

const listToday = async (token = adminToken) =>
  (await request(context.app).get('/api/cash-counts').set(auth(token)).query({ startDate: today(), endDate: today() })).body.data;

describe('end-of-day cash check', () => {
  it('should take the float off the count and compare the rest with the day\'s sales', async () => {
    await sell(20, 3); // €60 of sales; the default shop float is €50.
    const response = await request(context.app).post('/api/cash-counts').set(auth(adminToken)).send({ place: 'shop', counted: 105 });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ place: 'shop', float: 50, counted: 105, expected: 60, difference: -5 });
    const alerts = await context.db.selectFrom('notifications').select(['title']).where('type', '=', 'cash_difference').execute();
    expect(alerts[0]!.title).toBe('Shop cash short by €5.00');
  });

  it('should keep the count blind for employees and not alert when it matches', async () => {
    await sell(10, 2);
    const employeeToken = await loginAs(context, 'employee');

    const before = await request(context.app).get('/api/cash-counts/today').set(auth(employeeToken));
    expect(before.body.data).toEqual([
      { place: 'shop', carwashId: null, name: null, float: 50, countedBy: null, countedAt: null },
      { place: 'carwash', carwashId: 1, name: 'Carwash', float: 0, countedBy: null, countedAt: null },
    ]);
    const response = await request(context.app).post('/api/cash-counts').set(auth(employeeToken)).send({ place: 'shop', counted: 70.2 });

    expect(response.status).toBe(201);
    expect(response.body.data).toBeNull();
    expect((await request(context.app).get('/api/cash-counts').set(auth(employeeToken)).query({ startDate: today(), endDate: today() })).status).toBe(403);
    expect((await request(context.app).get('/api/cash-counts/today').set(auth(employeeToken))).body.data[0].countedBy).toBeTruthy();
    // 20 cents off is a few coins: a match, no alert.
    expect(await context.db.selectFrom('notifications').select('id').where('type', '=', 'cash_difference').execute()).toHaveLength(0);
  });

  it('should compare the carwash drawer with its takings, and replace a recount', async () => {
    await request(context.app).put(`/api/carwash/${today()}`).set(auth(adminToken)).send({ carwash: 80, change: 20 });
    await request(context.app).post('/api/cash-counts').set(auth(adminToken)).send({ place: 'carwash', counted: 90 });
    await request(context.app).post('/api/cash-counts').set(auth(adminToken)).send({ place: 'carwash', counted: 100, note: 'Recounted' });

    const [count] = await listToday();
    expect(count).toMatchObject({ place: 'carwash', counted: 100, expected: 100, difference: 0, note: 'Recounted' });
    expect(await listToday()).toHaveLength(1);
  });

  it('should use the floats set in Settings', async () => {
    await request(context.app).put('/api/settings').set(auth(adminToken)).send({ cashFloatShop: 100 });
    const response = await request(context.app).post('/api/cash-counts').set(auth(adminToken)).send({ place: 'shop', counted: 100 });

    expect(response.body.data).toMatchObject({ float: 100, expected: 0, difference: 0 });
  });

  it("should be in the owner's daily summary", async () => {
    const before = await context.container.dailySummaryService.compose(new Date());
    await sell(20, 1);
    await request(context.app).post('/api/cash-counts').set(auth(adminToken)).send({ place: 'shop', counted: 75 });
    const after = await context.container.dailySummaryService.compose(new Date());

    expect(before.message).toContain('Shop cash not counted yet.');
    expect(after.message).toContain('Shop cash: €5.00 over.');
    expect(after.message).not.toContain('Carwash cash');
  });

  it('should refuse made-up places and negative counts', async () => {
    expect((await request(context.app).post('/api/cash-counts').set(auth(adminToken)).send({ place: 'bank', counted: 5 })).status).toBe(400);
    expect((await request(context.app).post('/api/cash-counts').set(auth(adminToken)).send({ place: 'shop', counted: -1 })).status).toBe(400);
  });
});
