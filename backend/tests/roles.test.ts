import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestProduct, createTestUser, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let developerToken: string;
let ownerToken: string;
let adminToken: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  developerToken = await loginAs(context, 'developer');
  ownerToken = await loginAs(context, 'owner');
  adminToken = await loginAs(context, 'admin');
});
afterAll(() => context.db.destroy());

describe('the owner', () => {
  it('should see the business: activity, people, reports and sales', async () => {
    for (const path of ['/api/activity', '/api/users', '/api/analytics/dashboard', '/api/sales', '/api/approvals/summary']) {
      const response = await request(context.app).get(path).set(auth(ownerToken));
      expect(response.status, path).toBe(200);
    }
  });

  it('should be allowed to decide requests', async () => {
    // A request that doesn't exist: getting past the role check means a 404, not a 403.
    const response = await request(context.app).post('/api/returns/999999/approve').set(auth(ownerToken)).send({});

    expect(response.status).toBe(404);
  });

  it('should record sales', async () => {
    const productId = await createTestProduct(context, developerToken);

    const response = await request(context.app).post('/api/sales').set(auth(ownerToken)).send({ productId, quantity: 1 });

    expect(response.status).toBe(201);
  });

  it('should not change products, settings or people', async () => {
    const attempts = [
      request(context.app).post('/api/categories').set(auth(ownerToken)).send({ name: 'Lamps' }),
      request(context.app).put('/api/settings').set(auth(ownerToken)).send({ returnWindowDays: 3 }),
      request(context.app).post('/api/invites').set(auth(ownerToken)).send({ email: 'x@example.com', role: 'employee' }),
    ];
    for (const response of await Promise.all(attempts)) expect(response.status).toBe(403);
  });

  it('should get stock alerts and the weekly report like the people who run the shop', async () => {
    const productId = await createTestProduct(context, developerToken, { stock: 3, reorderLevel: 2 });
    await request(context.app).post('/api/sales').set(auth(developerToken)).send({ productId, quantity: 2 });

    const alerts = await request(context.app).get('/api/notifications').set(auth(ownerToken));
    expect(alerts.body.data.notifications[0].title).toBe('Low stock: Oak Chair');

    await context.container.weeklyReportService.sendIfDue(new Date('2026-10-05T19:30:00Z'));
    const emails = await context.db.selectFrom('email_outbox').select('to_address').execute();
    expect(emails.map((email) => email.to_address)).toEqual(
      expect.arrayContaining(['owner@test.local', 'developer@test.local', 'admin@test.local']),
    );
  });
});

describe('who may hand out roles', () => {
  it('should let an admin add employees and family, but not owners, admins or developers', async () => {
    const make = (role: string) =>
      request(context.app)
        .post('/api/users')
        .set(auth(adminToken))
        .send({ email: `${role}-new@example.com`, name: 'New person', password: 'a-long-password', role });

    expect((await make('employee')).status).toBe(201);
    expect((await make('family')).status).toBe(201);
    for (const role of ['owner', 'admin', 'developer']) expect((await make(role)).status, role).toBe(403);
  });

  it('should not let an admin promote someone or change the owner', async () => {
    const employee = await createTestUser(context.db, 'employee');
    const owner = await context.db.selectFrom('users').select('id').where('role', '=', 'owner').executeTakeFirstOrThrow();

    const promote = await request(context.app).put(`/api/users/${employee.id}`).set(auth(adminToken)).send({ role: 'admin' });
    const block = await request(context.app).put(`/api/users/${owner.id}`).set(auth(adminToken)).send({ isActive: false });

    expect(promote.status).toBe(403);
    expect(block.status).toBe(403);
  });

  it('should not let an admin invite an owner', async () => {
    const response = await request(context.app)
      .post('/api/invites')
      .set(auth(adminToken))
      .send({ email: 'dad@example.com', role: 'owner' });

    expect(response.status).toBe(403);
  });

  it('should let the developer make someone the owner or an admin', async () => {
    const employee = await createTestUser(context.db, 'employee');

    const owner = await request(context.app).put(`/api/users/${employee.id}`).set(auth(developerToken)).send({ role: 'owner' });
    const invite = await request(context.app)
      .post('/api/invites')
      .set(auth(developerToken))
      .send({ email: 'manager@example.com', role: 'admin' });

    expect(owner.status).toBe(200);
    expect(owner.body.data.role).toBe('owner');
    expect(invite.status).toBe(201);
  });

  it('should keep at least one developer', async () => {
    const developer = await context.db.selectFrom('users').select('id').where('role', '=', 'developer').executeTakeFirstOrThrow();

    const response = await request(context.app)
      .put(`/api/users/${developer.id}`)
      .set(auth(developerToken))
      .send({ role: 'admin' });

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/only developer/);
  });
});
