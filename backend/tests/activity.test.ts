import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityLogRepository } from '../src/repositories/ActivityLogRepository.js';
import { createTestCategory, createTestUser, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

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
const listActivity = (query = '') => request(context.app).get(`/api/activity${query}`).set(auth(adminToken));

describe('GET /api/activity', () => {
  it('should list entries newest first with who did them', async () => {
    const employee = await createTestUser(context.db, 'employee');
    const repository = new ActivityLogRepository(context.db);
    await repository.create({ userId: employee.id, action: 'product.created', entityType: 'product', entityId: 1, summary: 'Added product Chair' });
    await repository.create({ userId: employee.id, action: 'product.deleted', entityType: 'product', entityId: 1, summary: 'Deleted product Chair' });

    const response = await listActivity('?entityType=product');

    expect(response.status).toBe(200);
    expect(response.body.data.map((entry: { summary: string }) => entry.summary)).toEqual([
      'Deleted product Chair',
      'Added product Chair',
    ]);
    expect(response.body.data[0].user).toEqual({ id: employee.id, name: 'Test employee' });
    expect(response.body.meta.total).toBe(2);
  });

  it('should filter by action prefix, exact action, person and entity', async () => {
    const employee = await createTestUser(context.db, 'employee');
    const repository = new ActivityLogRepository(context.db);
    await repository.create({ userId: employee.id, action: 'stock.adjusted', entityType: 'product', entityId: 7, summary: 'Added 5 to Lamp (Restock)' });
    await repository.create({ userId: null, action: 'category.created', entityType: 'category', entityId: 2, summary: 'Added category Lighting' });
    await repository.create({ userId: employee.id, action: 'pricing.updated', entityType: 'product', entityId: 8, summary: 'Updated bulk prices for Rug' });

    const byPrefixes = await listActivity('?action=category,pricing');
    const byExact = await listActivity('?action=stock.adjusted');
    const byPerson = await listActivity(`?userId=${employee.id}`);
    const byEntity = await listActivity('?entityType=product&entityId=7');

    expect(byPrefixes.body.data).toHaveLength(2);
    expect(byExact.body.data.map((entry: { action: string }) => entry.action)).toEqual(['stock.adjusted']);
    expect(byPerson.body.data).toHaveLength(2);
    expect(byEntity.body.data).toHaveLength(1);
  });

  it('should leave out excluded kinds, like logins', async () => {
    const repository = new ActivityLogRepository(context.db);
    await repository.create({ userId: null, action: 'category.created', entityType: 'category', entityId: 2, summary: 'Added category Lighting' });

    // beforeEach logged the admin in, so there's one login to hide.
    const withoutLogins = await listActivity('?exclude=auth');
    const withoutOneAction = await listActivity('?exclude=auth.logged_in,category');

    expect(withoutLogins.body.data.map((entry: { action: string }) => entry.action)).toEqual(['category.created']);
    expect(withoutOneAction.body.data).toEqual([]);
  });

  it('should be admin only', async () => {
    const employeeToken = await loginAs(context, 'employee');

    const response = await request(context.app).get('/api/activity').set(auth(employeeToken));

    expect(response.status).toBe(403);
  });

  it('should reject a malformed action filter', async () => {
    const response = await listActivity('?action=DROP%20TABLE');

    expect(response.status).toBe(400);
  });
});

describe('catalog activity', () => {
  async function activitySummaries(action: string) {
    const response = await listActivity(`?action=${action}`);
    return response.body.data.map((entry: { summary: string }) => entry.summary);
  }

  it('should log creating, editing, re-pricing and deleting a product', async () => {
    const category = await createTestCategory(context.db);
    const created = await request(context.app)
      .post('/api/products')
      .set(auth(adminToken))
      .send({ name: 'Oak Chair', categoryId: category.id, price: 89, stock: 5 });
    const productId = created.body.data.id;

    await request(context.app)
      .put(`/api/products/${productId}`)
      .set(auth(adminToken))
      .send({ name: 'Oak Chair', categoryId: category.id, price: 95 });
    await request(context.app)
      .put(`/api/pricing/tiers/${productId}`)
      .set(auth(adminToken))
      .send({ tiers: [{ quantity: 10, price: 90 }] });
    await request(context.app).delete(`/api/products/${productId}`).set(auth(adminToken));

    expect(await activitySummaries('product,pricing')).toEqual([
      'Deleted product Oak Chair',
      'Updated bulk prices for Oak Chair',
      'Changed price of Oak Chair from €89.00 to €95.00',
      'Added product Oak Chair',
    ]);
  });

  it('should not log a product save that changed nothing', async () => {
    const category = await createTestCategory(context.db);
    const created = await request(context.app)
      .post('/api/products')
      .set(auth(adminToken))
      .send({ name: 'Lamp', categoryId: category.id, price: 30 });

    await request(context.app)
      .put(`/api/products/${created.body.data.id}`)
      .set(auth(adminToken))
      .send({ name: 'Lamp', categoryId: category.id, price: 30 });

    expect(await activitySummaries('product.updated')).toEqual([]);
  });

  it('should log category changes with the admin as the author', async () => {
    const created = await request(context.app).post('/api/categories').set(auth(adminToken)).send({ name: 'Lighting' });
    await request(context.app)
      .put(`/api/categories/${created.body.data.id}`)
      .set(auth(adminToken))
      .send({ name: 'Lamps' });
    await request(context.app).delete(`/api/categories/${created.body.data.id}`).set(auth(adminToken));

    const response = await listActivity('?action=category');

    expect(response.body.data.map((entry: { summary: string }) => entry.summary)).toEqual([
      'Deleted category Lamps',
      'Renamed category Lighting to Lamps',
      'Added category Lighting',
    ]);
    expect(response.body.data[0].user.name).toBe('Test admin');
  });
});

describe('stock, sales, people and login activity', () => {
  async function createProduct() {
    const category = await createTestCategory(context.db);
    const created = await request(context.app)
      .post('/api/products')
      .set(auth(adminToken))
      .send({ name: 'Oak Chair', categoryId: category.id, price: 100, stock: 20, reorderLevel: 5 });
    return created.body.data.id as number;
  }

  it('should log stock adjustments and reorder level changes', async () => {
    const productId = await createProduct();

    await request(context.app)
      .patch(`/api/inventory/${productId}`)
      .set(auth(adminToken))
      .send({ quantity: -3, reason: 'Manual adjustment', reorderLevel: 8 });
    const response = await listActivity('?action=stock');

    expect(response.body.data.map((entry: { summary: string }) => entry.summary)).toEqual([
      'Removed 3 from Oak Chair (Manual adjustment)',
      'Changed reorder level of Oak Chair from 5 to 8',
    ]);
    expect(response.body.data[0].details).toMatchObject({ quantity: -3, before: 20, after: 17 });
  });

  it('should log nothing when a stock adjustment fails', async () => {
    const productId = await createProduct();

    await request(context.app)
      .patch(`/api/inventory/${productId}`)
      .set(auth(adminToken))
      .send({ quantity: -500, reason: 'Manual adjustment', reorderLevel: 1 });
    const response = await listActivity('?action=stock');

    expect(response.body.data).toEqual([]);
  });

  it('should log a sale with the seller', async () => {
    const productId = await createProduct();
    const employeeToken = await loginAs(context, 'employee');

    await request(context.app).post('/api/sales').set(auth(employeeToken)).send({ productId, quantity: 2 });
    const response = await listActivity('?action=sale.recorded');

    expect(response.body.data[0]).toMatchObject({
      summary: 'Sold 2 × Oak Chair for €200.00',
      entityType: 'sale',
      user: { name: 'Test employee' },
    });
  });

  it('should log people changes without ever storing a password', async () => {
    const created = await request(context.app)
      .post('/api/users')
      .set(auth(adminToken))
      .send({ email: 'sam@test.local', name: 'Sam', role: 'employee', password: 'first-secret-pw' });
    const samId = created.body.data.id;
    await request(context.app)
      .put(`/api/users/${samId}`)
      .set(auth(adminToken))
      .send({ role: 'family', password: 'second-secret-pw' });
    await request(context.app).delete(`/api/users/${samId}`).set(auth(adminToken));

    const response = await listActivity('?action=user');

    expect(response.body.data.map((entry: { summary: string }) => entry.summary)).toEqual([
      'Removed Sam',
      "Changed Sam's role from employee to family; set a new password for Sam",
      'Added Sam as employee',
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(/secret-pw/);
  });

  it('should log logins', async () => {
    const response = await listActivity('?action=auth.logged_in');

    // beforeEach logged the admin in once.
    expect(response.body.data.map((entry: { summary: string }) => entry.summary)).toEqual(['Test admin logged in']);
  });
});
