import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityLogRepository } from '../src/repositories/ActivityLogRepository.js';
import { createTestUser, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

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
