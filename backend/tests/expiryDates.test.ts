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

const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
// Shop time is Europe/Budapest; noon there on 1 October.
const OCT_1 = new Date('2026-10-01T10:00:00Z');

describe('expiry dates', () => {
  it('should warn a week ahead, urgently in the last two days and once expired', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 1.2, stock: 30 });
    const employeeToken = await loginAs(context, 'employee');
    for (const [quantity, expiresOn] of [
      [6, '2026-09-30'],
      [12, '2026-10-06'],
      [10, '2026-10-20'],
    ] as const) {
      const response = await request(context.app).post('/api/expiry').set(auth(employeeToken)).send({ productId: milk, quantity, expiresOn });
      expect(response.status).toBe(201);
    }

    const insights = (await context.container.insightsService.list(OCT_1)).filter((insight) => insight.kind === 'expiring');

    expect(insights.map((insight) => [insight.title, insight.severity])).toEqual([
      ['6 × Milk expired 1 day ago', 'urgent'],
      ['12 × Milk expire in 5 days', 'warning'],
    ]);
  });

  it('should stop warning once dealt with', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 1.2, stock: 30 });
    const added = (await request(context.app).post('/api/expiry').set(auth()).send({ productId: milk, quantity: 6, expiresOn: '2026-10-02' })).body.data;

    await request(context.app).post(`/api/expiry/${added.id}/clear`).set(auth());

    expect((await context.container.insightsService.list(OCT_1)).filter((insight) => insight.kind === 'expiring')).toHaveLength(0);
    expect((await request(context.app).get('/api/expiry').set(auth()).query({ productId: milk })).body.data).toHaveLength(0);
    expect((await request(context.app).post(`/api/expiry/${added.id}/clear`).set(auth())).status).toBe(409);
  });

  it('should note expiry dates from a delivery', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 1.2, stock: 0 });
    const supplier = (await request(context.app).post('/api/suppliers').set(auth()).send({ name: 'Fresh Foods', nui: '811234567' })).body.data.id;
    const order = (await request(context.app).post('/api/orders').set(auth()).send({ supplierId: supplier, lines: [{ productId: milk, quantity: 24 }] })).body.data;

    await request(context.app)
      .post(`/api/orders/${order.id}/receive`)
      .set(auth())
      .send({ lines: [{ lineId: order.lines[0].id, receivedQuantity: 24, expiresOn: '2026-10-15' }] });

    const [expiry] = (await request(context.app).get('/api/expiry').set(auth()).query({ productId: milk })).body.data;
    expect(expiry).toMatchObject({ quantity: 24, expiresOn: '2026-10-15', note: `Order #${order.id} from Fresh Foods` });
  });

  it('should refuse made-up days', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 1.2, stock: 1 });
    expect((await request(context.app).post('/api/expiry').set(auth()).send({ productId: milk, quantity: 1, expiresOn: '2026-02-30' })).status).toBe(400);
  });
});

describe('expiry dates and units that left the shelf', () => {
  const sell = (productId: number, quantity: number) =>
    request(context.app).post('/api/sales').set(auth()).send({ productId, quantity });
  const note = (productId: number, quantity: number, expiresOn: string) =>
    request(context.app).post('/api/expiry').set(auth()).send({ productId, quantity, expiresOn });
  const warnings = async () => (await context.container.insightsService.list(OCT_1)).filter((insight) => insight.kind === 'expiring');

  it('should only count the units still on the shelf, taking the sold ones off the soonest date first', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 1.2, stock: 20 });
    await note(milk, 10, '2026-10-03');
    await note(milk, 10, '2026-10-05');

    await sell(milk, 14); // 6 left: the first date is gone and 6 of the second remain

    const dates = (await request(context.app).get('/api/expiry').set(auth()).query({ productId: milk })).body.data;
    expect(dates.map((date: { expiresOn: string; quantity: number; remaining: number }) => [date.expiresOn, date.quantity, date.remaining])).toEqual([
      ['2026-10-05', 10, 6],
    ]);
    expect((await warnings()).map((insight) => insight.title)).toEqual(['6 × Milk expire in 4 days']);
  });

  it('should stop warning about a product that sold out or was written off', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 1.2, stock: 5 });
    await note(milk, 5, '2026-10-02');
    expect(await warnings()).toHaveLength(1);

    await sell(milk, 5);

    expect(await warnings()).toHaveLength(0);
  });

  it('should be cautious about units that were never noted', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 1.2, stock: 30 });
    await note(milk, 10, '2026-10-02');

    await sell(milk, 12); // 18 left, more than the 10 noted: all 10 may still be there

    expect((await warnings()).map((insight) => insight.title)).toEqual(['10 × Milk expire in 1 day']);
  });
});
