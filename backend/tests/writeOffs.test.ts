import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestProduct, loginAs, resetData, setupTestApp, stockOf, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let employeeToken: string;
let productId: number;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
  employeeToken = await loginAs(context, 'employee');
  productId = await createTestProduct(context, adminToken, { stock: 10, costPrice: 6 });
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const report = (token: string, body: Record<string, unknown> = {}) =>
  request(context.app)
    .post('/api/write-offs')
    .set(auth(token))
    .send({ productId, quantity: 2, reason: 'damaged', notes: 'Dropped', ...body });

const notificationsFor = (title: string) =>
  context.db.selectFrom('notifications').selectAll().where('title', 'like', `%${title}%`).execute();

describe('write-offs', () => {
  it('should write off straight away when the admin reports it', async () => {
    const response = await report(adminToken);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ status: 'approved', quantity: 2, unitCost: 6, value: 12, reason: 'damaged' });
    expect(await stockOf(context, productId)).toBe(8);
  });

  it('should wait for approval when an employee reports it', async () => {
    const response = await report(employeeToken);

    expect(response.body.data.status).toBe('pending');
    expect(await stockOf(context, productId)).toBe(10);
    expect(await notificationsFor('waiting for approval')).toHaveLength(1);
  });

  it('should take the stock away when approved', async () => {
    const { body } = await report(employeeToken);

    const approved = await request(context.app).post(`/api/write-offs/${body.data.id}/approve`).set(auth(adminToken));
    const log = await context.db.selectFrom('activity_log').select('action').where('action', '=', 'write_off.approved').execute();

    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('approved');
    expect(await stockOf(context, productId)).toBe(8);
    expect(log).toHaveLength(1);
    expect(await notificationsFor('was approved')).toHaveLength(1);
  });

  it('should mark the "waiting for approval" alert read once it is decided', async () => {
    const approvedLater = (await report(employeeToken)).body.data.id;
    const rejectedLater = (await report(employeeToken, { quantity: 1 })).body.data.id;
    const unread = async () =>
      (await notificationsFor('waiting for approval')).filter((notification) => !notification.is_read).length;
    expect(await unread()).toBe(2);

    await request(context.app).post(`/api/write-offs/${approvedLater}/approve`).set(auth(adminToken));
    expect(await unread()).toBe(1);

    await request(context.app).post(`/api/write-offs/${rejectedLater}/reject`).set(auth(adminToken)).send({ note: 'Not broken' });
    expect(await unread()).toBe(0);
  });

  it('should leave stock alone when rejected, and keep the reason', async () => {
    const { body } = await report(employeeToken);

    const withoutReason = await request(context.app).post(`/api/write-offs/${body.data.id}/reject`).set(auth(adminToken)).send({});
    const rejected = await request(context.app)
      .post(`/api/write-offs/${body.data.id}/reject`)
      .set(auth(adminToken))
      .send({ note: 'Still sellable' });

    expect(withoutReason.status).toBe(400);
    expect(rejected.body.data).toMatchObject({ status: 'rejected', decisionNote: 'Still sellable' });
    expect(await stockOf(context, productId)).toBe(10);
  });

  it('should refuse to approve when the stock is no longer there', async () => {
    const { body } = await report(employeeToken, { quantity: 10 });
    await request(context.app).post('/api/sales').set(auth(adminToken)).send({ productId, quantity: 1 });

    const approved = await request(context.app).post(`/api/write-offs/${body.data.id}/approve`).set(auth(adminToken));

    expect(approved.status).toBe(409);
    expect(approved.body.message).toContain('Only 9 left');
    expect(await stockOf(context, productId)).toBe(9);
  });

  it('should not decide twice', async () => {
    const { body } = await report(employeeToken);
    await request(context.app).post(`/api/write-offs/${body.data.id}/approve`).set(auth(adminToken));

    const again = await request(context.app).post(`/api/write-offs/${body.data.id}/approve`).set(auth(adminToken));

    expect(again.status).toBe(409);
    expect(await stockOf(context, productId)).toBe(8);
  });

  it('should list write-offs waiting for approval for the admin only', async () => {
    await report(employeeToken);
    await report(adminToken);

    const pending = await request(context.app).get('/api/write-offs?status=pending').set(auth(adminToken));
    const asEmployee = await request(context.app).get('/api/write-offs').set(auth(employeeToken));

    expect(pending.body.data).toHaveLength(1);
    expect(pending.body.data[0]).toMatchObject({ productName: 'Oak Chair', requestedBy: { name: 'Test employee' } });
    expect(asEmployee.status).toBe(403);
  });

  it('should refuse a write-off of more than is in stock straight away', async () => {
    const response = await report(employeeToken, { quantity: 11 });
    const saved = await context.db.selectFrom('write_offs').selectAll().execute();

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Only 10 in stock');
    expect(saved).toHaveLength(0);
  });

  it('should not let family members report losses', async () => {
    const familyToken = await loginAs(context, 'family');

    const response = await report(familyToken);

    expect(response.status).toBe(403);
  });
});
