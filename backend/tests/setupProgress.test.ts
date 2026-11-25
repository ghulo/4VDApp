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

describe('setup progress', () => {
  it('should give the same counts as the Products, People and invite lists', async () => {
    await createTestProduct(context, adminToken, { name: 'Lamp' });
    await createTestProduct(context, adminToken, { name: 'Vase' });
    await request(context.app).post('/api/invites').set(auth()).send({ email: 'new.person@example.com', role: 'employee' });

    const [progress, products, people, invites] = await Promise.all([
      request(context.app).get('/api/setup-progress').set(auth()),
      request(context.app).get('/api/products?page=1&limit=1').set(auth()),
      request(context.app).get('/api/users?page=1&limit=1').set(auth()),
      request(context.app).get('/api/invites').set(auth()),
    ]);

    expect(progress.status).toBe(200);
    expect(progress.body.data).toEqual({
      productCount: products.body.meta.total,
      peopleCount: people.body.meta.total,
      openInvites: invites.body.data.length,
    });
    expect(progress.body.data.productCount).toBe(2);
    expect(progress.body.data.openInvites).toBe(1);
  });

  it('should be for those who manage the business only', async () => {
    const employeeToken = await loginAs(context, 'employee');
    const response = await request(context.app).get('/api/setup-progress').set(auth(employeeToken));
    expect(response.status).toBe(403);
  });
});
