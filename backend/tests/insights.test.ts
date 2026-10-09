import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startOfZonedDay } from '../src/utils/zonedDates.js';
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
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

async function sell(productId: number, quantity: number, saleDate?: string) {
  const response = await request(context.app).post('/api/sales').set(auth(employeeToken)).send({ productId, quantity, saleDate });
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
}

const insights = async () => (await request(context.app).get('/api/reports/insights').set(auth(adminToken))).body.data;

describe('insights', () => {
  it('should warn about products running out or sold out, most urgent first', async () => {
    const lamp = await createTestProduct(context, adminToken, { name: 'Lamp', stock: 13, reorderLevel: 0 });
    const vase = await createTestProduct(context, adminToken, { name: 'Vase', stock: 2, reorderLevel: 0 });
    await sell(lamp, 10);
    await sell(vase, 2);

    const result = await insights();

    expect(result).toEqual([
      expect.objectContaining({ kind: 'sold_out', severity: 'urgent', productId: vase }),
      expect.objectContaining({ kind: 'running_out', severity: 'urgent', productId: lamp, title: 'Lamp runs out in about 2 days' }),
    ]);
  });

  it('should flag sales below cost, unusually big sales and missing stock', async () => {
    const cheap = await createTestProduct(context, adminToken, { name: 'Cheap Chair', price: 50, costPrice: 60, stock: 1000, reorderLevel: 0 });
    for (let day = 20; day < 25; day++) await sell(cheap, 1, daysAgo(day));
    await sell(cheap, 10);
    await request(context.app)
      .post('/api/write-offs')
      .set(auth(adminToken))
      .send({ productId: cheap, quantity: 3, reason: 'lost' });

    const kinds = (await insights()).map((insight: { kind: string }) => insight.kind);

    expect(kinds).toEqual(expect.arrayContaining(['below_cost', 'unusual_sale', 'missing_stock']));
  });

  it('should point out stock that hasn’t sold in two months', async () => {
    const rug = await createTestProduct(context, adminToken, { name: 'Old Rug', stock: 4, costPrice: 25, reorderLevel: 0 });
    await sql`UPDATE products SET created_at = now() - interval '90 days'`.execute(context.db);

    const result = await insights();

    expect(result).toEqual([
      expect.objectContaining({ kind: 'dead_stock', severity: 'info', productId: rug, detail: expect.stringContaining('€100.00 tied up') }),
    ]);
  });

  it('should be for admins only', async () => {
    const response = await request(context.app).get('/api/reports/insights').set(auth(employeeToken));

    expect(response.status).toBe(403);
  });
});

describe('daily summary', () => {
  // 21:30 in Budapest (summer time, UTC+2).
  const EVENING = new Date('2026-10-02T19:30:00Z');

  it('should sum today’s sales and say when nothing needs attention', async () => {
    const chair = await createTestProduct(context, adminToken, { name: 'Chair', price: 100, costPrice: 60, stock: 1000, reorderLevel: 0 });
    await sell(chair, 2);

    const summary = await context.container.dailySummaryService.compose();

    expect(summary.title).toBe('Today: €200.00 in sales');
    expect(summary.message).toContain('1 sale, €80.00 profit');
  });

});

describe('startOfZonedDay', () => {
  it('should find local midnight in summer and winter time', () => {
    expect(startOfZonedDay(new Date('2026-10-02T19:30:00Z'), 'Europe/Budapest').toISOString()).toBe('2026-10-01T22:00:00.000Z');
    expect(startOfZonedDay(new Date('2026-12-02T00:30:00Z'), 'Europe/Budapest').toISOString()).toBe('2026-12-01T23:00:00.000Z');
  });
});
