import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestCategory, createTestUser, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

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

const MARCH = 'startDate=2026-03-01&endDate=2026-03-31';

describe('GET /api/reports/summary', () => {
  it('should total the period and compare it with the period before', async () => {
    const productId = await createProduct();
    const employeeToken = await loginAs(context, 'employee');
    await sell(employeeToken, productId, 2, '2026-03-10T12:00:00Z');
    await sell(adminToken, productId, 1, '2026-03-20T12:00:00Z');
    await sell(adminToken, productId, 1, '2026-02-15T12:00:00Z');

    const response = await request(context.app).get(`/api/reports/summary?${MARCH}`).set(auth(adminToken));

    expect(response.status).toBe(200);
    expect(response.body.data.current).toEqual({
      revenue: 300,
      revenueWithoutCost: 0,
      cost: 180,
      profit: 120,
      margin: 0.4,
      unitsSold: 3,
      salesCount: 2,
      refunds: 0,
      stockLosses: 0,
      lossUnitsWithoutCost: 0,
    });
    expect(response.body.data.previous.revenue).toBe(100);
    expect(response.body.data.change).toEqual({ revenue: 2, profit: 2, unitsSold: 2, salesCount: 1 });
  });

  it('should keep products without a cost out of profit and margin', async () => {
    const withCost = await createProduct();
    const withoutCost = await createProduct({ name: 'Mystery Lamp', costPrice: null });
    await sell(adminToken, withCost, 1, '2026-03-05T12:00:00Z');
    await sell(adminToken, withoutCost, 1, '2026-03-05T12:00:00Z');

    const response = await request(context.app).get(`/api/reports/summary?${MARCH}`).set(auth(adminToken));

    expect(response.body.data.current).toMatchObject({ revenue: 200, revenueWithoutCost: 100, profit: 40, margin: 0.4 });
  });

  it('should report no change instead of infinity when the previous period was empty', async () => {
    const productId = await createProduct();
    await sell(adminToken, productId, 1, '2026-03-05T12:00:00Z');

    const response = await request(context.app).get(`/api/reports/summary?${MARCH}`).set(auth(adminToken));

    expect(response.body.data.change.revenue).toBeNull();
  });

  it('should compare with an explicit period when one is given', async () => {
    const productId = await createProduct();
    await sell(adminToken, productId, 1, '2026-03-02T12:00:00Z');
    await sell(adminToken, productId, 2, '2026-02-02T12:00:00Z');
    await sell(adminToken, productId, 3, '2026-02-20T12:00:00Z');

    // March 1-3 against February 1-3, not against the days just before March 1.
    const response = await request(context.app)
      .get(
        '/api/reports/summary?startDate=2026-03-01&endDate=2026-03-03' +
          '&previousStartDate=2026-02-01&previousEndDate=2026-02-03',
      )
      .set(auth(adminToken));

    expect(response.body.data.previous).toMatchObject({ revenue: 200, unitsSold: 2 });
    expect(response.body.data.change.revenue).toBe(-0.5);
  });

  it('should need both ends of an explicit comparison period', async () => {
    const response = await request(context.app)
      .get(`/api/reports/summary?${MARCH}&previousStartDate=2026-02-01`)
      .set(auth(adminToken));

    expect(response.status).toBe(400);
  });

  it('should include sales late on a date-only end date', async () => {
    const productId = await createProduct();
    await sell(adminToken, productId, 1, '2026-03-31T22:30:00Z');

    const response = await request(context.app).get(`/api/reports/summary?${MARCH}`).set(auth(adminToken));

    expect(response.body.data.current.salesCount).toBe(1);
  });

  it('should reject ranges that are backwards or longer than a year', async () => {
    const backwards = await request(context.app)
      .get('/api/reports/summary?startDate=2026-03-31&endDate=2026-03-01')
      .set(auth(adminToken));
    const tooLong = await request(context.app)
      .get('/api/reports/summary?startDate=2024-01-01&endDate=2026-01-01')
      .set(auth(adminToken));
    const missing = await request(context.app).get('/api/reports/summary').set(auth(adminToken));

    expect(backwards.status).toBe(400);
    expect(tooLong.status).toBe(400);
    expect(missing.status).toBe(400);
  });

  it('should not allow an extra day for exact times, only fit a full year of dates', async () => {
    const overByHalfADay = await request(context.app)
      .get('/api/reports/summary?startDate=2026-01-01T00:00:00Z&endDate=2027-01-02T12:00:00Z')
      .set(auth(adminToken));
    const fullYear = await request(context.app)
      .get('/api/reports/summary?startDate=2026-01-01&endDate=2027-01-01')
      .set(auth(adminToken));

    expect(overByHalfADay.status).toBe(400);
    expect(fullYear.status).toBe(200);
  });

  it('should be admin only', async () => {
    const employeeToken = await loginAs(context, 'employee');

    const response = await request(context.app).get(`/api/reports/summary?${MARCH}`).set(auth(employeeToken));

    expect(response.status).toBe(403);
  });
});

describe('GET /api/reports/team', () => {
  it('should total each seller, include people with no sales, and sort by revenue', async () => {
    const productId = await createProduct();
    const employeeToken = await loginAs(context, 'employee');
    await createTestUser(context.db, 'employee', { email: 'quiet@test.local' });
    await sell(employeeToken, productId, 2, '2026-03-10T12:00:00Z');
    await sell(employeeToken, productId, 1, '2026-03-11T12:00:00Z');
    await sell(adminToken, productId, 1, '2026-03-12T12:00:00Z');

    const response = await request(context.app).get(`/api/reports/team?${MARCH}`).set(auth(adminToken));

    expect(response.body.data).toEqual([
      expect.objectContaining({ name: 'Test employee', salesCount: 2, unitsSold: 3, revenue: 300, profit: 120, averageSale: 150 }),
      expect.objectContaining({ name: 'Test admin', salesCount: 1, revenue: 100, averageSale: 100 }),
      expect.objectContaining({ salesCount: 0, revenue: 0, averageSale: 0 }),
    ]);
  });

  it('should keep sales of someone who has since been removed', async () => {
    const productId = await createProduct();
    const leaver = await createTestUser(context.db, 'employee', { email: 'leaver@test.local' });
    const leaverLogin = await request(context.app)
      .post('/api/auth/login')
      .send({ email: 'leaver@test.local', password: 'correct-horse-battery' });
    await sell(leaverLogin.body.data.token, productId, 1, '2026-03-10T12:00:00Z');
    await request(context.app).delete(`/api/users/${leaver.id}`).set(auth(adminToken));

    const response = await request(context.app).get(`/api/reports/team?${MARCH}`).set(auth(adminToken));

    expect(response.body.data).toContainEqual(expect.objectContaining({ userId: leaver.id, revenue: 100, hasLeft: true }));
    expect(response.body.data).toContainEqual(expect.objectContaining({ name: 'Test admin', hasLeft: false }));
  });

  it('should still credit sales of a product that was deleted later', async () => {
    const productId = await createProduct();
    await sell(adminToken, productId, 1, '2026-03-10T12:00:00Z');
    await request(context.app).delete(`/api/products/${productId}`).set(auth(adminToken));

    const team = await request(context.app).get(`/api/reports/team?${MARCH}`).set(auth(adminToken));
    const profit = await request(context.app).get(`/api/reports/profit?${MARCH}`).set(auth(adminToken));

    expect(team.body.data).toContainEqual(expect.objectContaining({ name: 'Test admin', revenue: 100 }));
    expect(profit.body.data).toEqual([expect.objectContaining({ id: productId, revenue: 100, profit: 40 })]);
  });
});

describe('GET /api/reports/profit', () => {
  it('should break profit down by product, flagging unknown costs', async () => {
    const chair = await createProduct();
    const lamp = await createProduct({ name: 'Mystery Lamp', costPrice: null });
    await sell(adminToken, chair, 2, '2026-03-05T12:00:00Z');
    await sell(adminToken, lamp, 1, '2026-03-05T12:00:00Z');

    const response = await request(context.app)
      .get(`/api/reports/profit?${MARCH}&groupBy=product`)
      .set(auth(adminToken));

    expect(response.body.data).toEqual([
      { id: chair, name: 'Oak Chair', unitsSold: 2, revenue: 200, cost: 120, profit: 80, margin: 0.4, hasUnknownCost: false },
      { id: lamp, name: 'Mystery Lamp', unitsSold: 1, revenue: 100, cost: 0, profit: 0, margin: null, hasUnknownCost: true },
    ]);
  });

  it('should group by category and still count products that were hidden later', async () => {
    const chair = await createProduct();
    await sell(adminToken, chair, 1, '2026-03-05T12:00:00Z');
    await context.db.updateTable('products').set({ is_active: false }).where('id', '=', chair).execute();

    const response = await request(context.app)
      .get(`/api/reports/profit?${MARCH}&groupBy=category`)
      .set(auth(adminToken));

    expect(response.body.data).toEqual([expect.objectContaining({ name: 'Furniture', revenue: 100, profit: 40 })]);
  });

  it('should leave unknown-cost sales out of a group margin instead of hiding the margin', async () => {
    const chair = await createProduct();
    const lamp = await createProduct({ name: 'Mystery Lamp', costPrice: null });
    await sell(adminToken, chair, 2, '2026-03-05T12:00:00Z');
    await sell(adminToken, lamp, 1, '2026-03-05T12:00:00Z');

    const response = await request(context.app)
      .get(`/api/reports/profit?${MARCH}&groupBy=category`)
      .set(auth(adminToken));

    // 80 profit on the 200 of revenue with a known cost; the lamp's 100 is left out.
    expect(response.body.data).toEqual([expect.objectContaining({ revenue: 300, profit: 80, margin: 0.4, hasUnknownCost: true })]);
  });

  it('should reject an unknown grouping', async () => {
    const response = await request(context.app)
      .get(`/api/reports/profit?${MARCH}&groupBy=colour`)
      .set(auth(adminToken));

    expect(response.status).toBe(400);
  });
});

describe('GET /api/reports/reorder-suggestions', () => {
  it('should estimate when each product runs out, soonest first', async () => {
    const fast = await createProduct({ name: 'Fast seller', stock: 30, reorderLevel: 10 });
    await createProduct({ name: 'Never sold', stock: 4, reorderLevel: 10 });
    await sell(adminToken, fast, 15);

    const response = await request(context.app).get('/api/reports/reorder-suggestions').set(auth(adminToken));

    expect(response.body.data).toEqual([
      { productId: fast, productName: 'Fast seller', quantity: 15, reorderLevel: 10, averageDailySales: 0.5, daysLeft: 30, suggestedOrder: 10 },
      expect.objectContaining({ productName: 'Never sold', daysLeft: null, suggestedOrder: 6 }),
    ]);
  });
});

describe('GET /api/reports/my-sales', () => {
  it('should show employees only their own numbers, without profit', async () => {
    const productId = await createProduct();
    const employeeToken = await loginAs(context, 'employee');
    await sell(employeeToken, productId, 2, '2026-03-10T12:00:00Z');
    await sell(employeeToken, productId, 1, '2026-02-10T12:00:00Z');
    await sell(adminToken, productId, 5, '2026-03-10T12:00:00Z');

    const response = await request(context.app).get(`/api/reports/my-sales?${MARCH}`).set(auth(employeeToken));

    expect(response.status).toBe(200);
    expect(response.body.data.current).toEqual({ salesCount: 1, unitsSold: 2, revenue: 200, refunds: 0 });
    expect(response.body.data.previous).toEqual({ salesCount: 1, unitsSold: 1, revenue: 100, refunds: 0 });
    expect(response.body.data.recentSales).toEqual([
      expect.objectContaining({ productName: 'Oak Chair', quantity: 2, totalAmount: 200 }),
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(/profit|cost/i);
  });

  it('should compare with the calendar month the app asks for', async () => {
    const productId = await createProduct();
    const employeeToken = await loginAs(context, 'employee');
    await sell(employeeToken, productId, 1, '2026-01-30T12:00:00Z');
    await sell(employeeToken, productId, 2, '2026-02-10T12:00:00Z');

    const response = await request(context.app)
      .get(`/api/reports/my-sales?${MARCH}&previousStartDate=2026-02-01&previousEndDate=2026-02-28`)
      .set(auth(employeeToken));

    // January 30 sits inside the "same length before" window but is not February.
    expect(response.body.data.previous).toEqual({ salesCount: 1, unitsSold: 2, revenue: 200, refunds: 0 });
  });

  it('should not be available to family members', async () => {
    const familyToken = await loginAs(context, 'family');

    const response = await request(context.app).get(`/api/reports/my-sales?${MARCH}`).set(auth(familyToken));

    expect(response.status).toBe(403);
  });
});
