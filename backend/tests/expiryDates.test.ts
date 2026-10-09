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
