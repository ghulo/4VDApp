import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestCategory,
  createTestUser,
  loginAs,
  resetData,
  setupTestApp,
  TEST_PASSWORD,
  type TestContext,
} from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let productId: number;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
  const category = await createTestCategory(context.db);
  const { body } = await request(context.app)
    .post('/api/products')
    .set(auth(adminToken))
    .send({
      name: 'Oak Chair',
      categoryId: category.id,
      price: 100,
      costPrice: 60,
      stock: 30,
      reorderLevel: 10,
      bulkPricingTiers: [{ quantity: 10, price: 90 }],
    });
  productId = body.data.id;
});
afterAll(() => context.db.destroy());

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const sell = (token: string, quantity: number, extra: Record<string, unknown> = {}) =>
  request(context.app).post('/api/sales').set(auth(token)).send({ productId, quantity, ...extra });

describe('sales', () => {
  it('should charge the bulk price and take the units out of stock', async () => {
    const response = await sell(adminToken, 12);
    const inventory = await request(context.app).get(`/api/inventory/${productId}`);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ quantity: 12, pricePerUnit: 90, totalAmount: 1080 });
    expect(inventory.body.data.quantity).toBe(18);
    expect(inventory.body.data.recentAdjustments[0]).toMatchObject({ quantity: -12, reason: 'Sale' });
  });

  it('should charge the normal price below the first tier', async () => {
    const response = await sell(adminToken, 2);

    expect(response.body.data.pricePerUnit).toBe(100);
  });

  it('should refuse a sale bigger than the stock and record nothing', async () => {
    const response = await sell(adminToken, 31);
    const sales = await context.db.selectFrom('sales').selectAll().execute();

    expect(response.status).toBe(400);
    expect(sales).toHaveLength(0);
  });

  it('should let employees record sales but not see the sales history', async () => {
    const employeeToken = await loginAs(context, 'employee');

    const recorded = await sell(employeeToken, 1);
    const history = await request(context.app).get('/api/sales').set(auth(employeeToken));

    expect(recorded.status).toBe(201);
    expect(recorded.body.data.soldBy).toBe('Test employee');
    expect(history.status).toBe(403);
  });

  it('should not let family members record sales', async () => {
    const familyToken = await loginAs(context, 'family');

    const response = await sell(familyToken, 1);

    expect(response.status).toBe(403);
  });

  it('should reject a sale dated in the future', async () => {
    const response = await sell(adminToken, 1, { saleDate: '2999-01-01' });

    expect(response.status).toBe(400);
  });

  it('should list sales in a date range with the total revenue', async () => {
    await sell(adminToken, 1, { saleDate: '2026-01-15T12:00:00Z' });
    await sell(adminToken, 2, { saleDate: '2026-02-15T12:00:00Z' });

    const response = await request(context.app)
      .get('/api/sales?startDate=2026-01-01&endDate=2026-01-31')
      .set(auth(adminToken));

    expect(response.body.data.sales).toHaveLength(1);
    expect(response.body.data.totalRevenue).toBe(100);
    expect(response.body.meta.total).toBe(1);
  });
});

describe('analytics', () => {
  it('should summarise sales, profit and stock on the dashboard', async () => {
    await sell(adminToken, 10); // 10 x 90 = 900 revenue, 10 x 30 = 300 profit
    await sell(adminToken, 15); // stock 30 -> 5: crosses the reorder level

    const response = await request(context.app).get('/api/analytics/dashboard').set(auth(adminToken));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      totalSales: 2,
      unitsSold: 25,
      totalRevenue: 2250,
      totalProfit: 750,
      lowStockCount: 1,
      inventoryValue: 300, // 5 left x cost 60
    });
    expect(response.body.data.topProducts[0]).toMatchObject({ productName: 'Oak Chair', unitsSold: 25 });
  });

  it('should return revenue per day including days with no sales', async () => {
    await sell(adminToken, 1, { saleDate: '2026-03-01T10:00:00Z' });
    await sell(adminToken, 1, { saleDate: '2026-03-03T10:00:00Z' });

    const response = await request(context.app)
      .get('/api/analytics/revenue?period=daily&startDate=2026-03-01&endDate=2026-03-03')
      .set(auth(adminToken));

    expect(response.body.data.points).toEqual([
      { periodStart: '2026-03-01', revenue: 100, unitsSold: 1, salesCount: 1 },
      { periodStart: '2026-03-02', revenue: 0, unitsSold: 0, salesCount: 0 },
      { periodStart: '2026-03-03', revenue: 100, unitsSold: 1, salesCount: 1 },
    ]);
    expect(response.body.data.totalRevenue).toBe(200);
  });

  it('should refuse a daily range that is far too long', async () => {
    const response = await request(context.app)
      .get('/api/analytics/revenue?period=daily&startDate=2020-01-01&endDate=2026-01-01')
      .set(auth(adminToken));

    expect(response.status).toBe(400);
  });

  it('should be admin only', async () => {
    const employeeToken = await loginAs(context, 'employee');

    const response = await request(context.app).get('/api/analytics/dashboard').set(auth(employeeToken));

    expect(response.status).toBe(403);
  });
});

describe('users', () => {
  it('should create an account that can log in', async () => {
    const created = await request(context.app)
      .post('/api/users')
      .set(auth(adminToken))
      .send({ email: 'Cousin@Family.com', name: 'Cousin', role: 'family', password: 'family-password' });
    const login = await request(context.app)
      .post('/api/auth/login')
      .send({ email: 'cousin@family.com', password: 'family-password' });

    expect(created.status).toBe(201);
    expect(created.body.data.email).toBe('cousin@family.com');
    expect(login.status).toBe(200);
  });

  it('should reject a duplicate email', async () => {
    const response = await request(context.app)
      .post('/api/users')
      .set(auth(adminToken))
      .send({ email: 'admin@test.local', name: 'Copy', role: 'family', password: 'some-password' });

    expect(response.status).toBe(409);
  });

  it('should not let the only admin demote themselves', async () => {
    const admin = await context.db.selectFrom('users').select('id').where('role', '=', 'admin').executeTakeFirstOrThrow();

    const response = await request(context.app)
      .put(`/api/users/${admin.id}`)
      .set(auth(adminToken))
      .send({ role: 'employee' });

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/only admin/);
  });

  it('should end every session of a deactivated user', async () => {
    const employee = await createTestUser(context.db, 'employee');
    const login = await request(context.app)
      .post('/api/auth/login')
      .send({ email: employee.email, password: TEST_PASSWORD });

    await request(context.app).put(`/api/users/${employee.id}`).set(auth(adminToken)).send({ isActive: false });
    const refresh = await request(context.app).post('/api/auth/refresh').send({ refreshToken: login.body.data.refreshToken });

    expect(refresh.status).toBe(401);
  });

  it('should not let admins delete their own account', async () => {
    const admin = await context.db.selectFrom('users').select('id').where('role', '=', 'admin').executeTakeFirstOrThrow();

    const response = await request(context.app).delete(`/api/users/${admin.id}`).set(auth(adminToken));

    expect(response.status).toBe(400);
  });
});

describe('notifications', () => {
  it('should show admins their low-stock alerts and let them mark them read', async () => {
    await sell(adminToken, 25);

    const list = await request(context.app).get('/api/notifications').set(auth(adminToken));
    const notificationId = list.body.data.notifications[0].id;
    await request(context.app).patch(`/api/notifications/${notificationId}/read`).set(auth(adminToken));
    const after = await request(context.app).get('/api/notifications').set(auth(adminToken));

    expect(list.body.data.unreadCount).toBe(1);
    expect(list.body.data.notifications[0].title).toBe('Low stock: Oak Chair');
    expect(after.body.data.unreadCount).toBe(0);
  });

  it("should not let someone mark another user's notification", async () => {
    await sell(adminToken, 25);
    const list = await request(context.app).get('/api/notifications').set(auth(adminToken));
    const familyToken = await loginAs(context, 'family');

    const response = await request(context.app)
      .patch(`/api/notifications/${list.body.data.notifications[0].id}/read`)
      .set(auth(familyToken));

    expect(response.status).toBe(404);
  });
});

describe('favorites', () => {
  it('should add, list and remove favorites', async () => {
    const familyToken = await loginAs(context, 'family');

    await request(context.app).put(`/api/favorites/${productId}`).set(auth(familyToken));
    await request(context.app).put(`/api/favorites/${productId}`).set(auth(familyToken)); // twice is fine
    const listed = await request(context.app).get('/api/favorites').set(auth(familyToken));
    await request(context.app).delete(`/api/favorites/${productId}`).set(auth(familyToken));
    const afterRemove = await request(context.app).get('/api/favorites/ids').set(auth(familyToken));

    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].name).toBe('Oak Chair');
    expect(listed.body.data[0]).not.toHaveProperty('costPrice');
    expect(afterRemove.body.data).toEqual([]);
  });

  it('should require being logged in', async () => {
    const response = await request(context.app).get('/api/favorites');

    expect(response.status).toBe(401);
  });
});
