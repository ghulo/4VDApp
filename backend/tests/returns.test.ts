import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestProduct,
  createTestUser,
  loginAs,
  resetData,
  setupTestApp,
  stockOf,
  TEST_PASSWORD,
  type TestContext,
} from './helpers/testApp.js';

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
  productId = await createTestProduct(context, adminToken, { price: 10, costPrice: 6, stock: 20 });
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const DAY = 24 * 60 * 60 * 1000;

async function sell(token: string, quantity: number, overrides: Record<string, unknown> = {}): Promise<number> {
  const response = await request(context.app)
    .post('/api/sales')
    .set(auth(token))
    .send({ productId, quantity, ...overrides });
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  return response.body.data.id as number;
}

const returnSale = (token: string, saleId: number, body: Record<string, unknown>) =>
  request(context.app).post(`/api/sales/${saleId}/returns`).set(auth(token)).send(body);

describe('returns', () => {
  it('should refund and restock straight away when nothing needs approval', async () => {
    const saleId = await sell(employeeToken, 2);

    const response = await returnSale(employeeToken, saleId, { quantity: 1, condition: 'resellable' });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ status: 'approved', quantity: 1, refundAmount: 10, needsApprovalBecause: [] });
    expect(await stockOf(context, productId)).toBe(19);
  });

  it('should wait for approval when the refund is over the limit', async () => {
    const saleId = await sell(employeeToken, 8);

    const response = await returnSale(employeeToken, saleId, { quantity: 8, condition: 'resellable' });
    const notifications = await context.db.selectFrom('notifications').select('title').execute();

    expect(response.body.data).toMatchObject({ status: 'pending', needsApprovalBecause: ['refund over €50'] });
    expect(await stockOf(context, productId)).toBe(12);
    expect(notifications.map((n) => n.title)).toContain('New return waiting for approval');
  });

  it('should wait for approval when the sale is older than the return window', async () => {
    const saleId = await sell(employeeToken, 1, { saleDate: new Date(Date.now() - 20 * DAY).toISOString() });

    const response = await returnSale(employeeToken, saleId, { quantity: 1, condition: 'resellable' });

    expect(response.body.data).toMatchObject({ status: 'pending', needsApprovalBecause: ['sold more than 14 days ago'] });
  });

  it('should turn a damaged return into a write-off when approved', async () => {
    const saleId = await sell(employeeToken, 2);
    const { body } = await returnSale(employeeToken, saleId, { quantity: 1, condition: 'damaged' });

    expect(body.data).toMatchObject({ status: 'pending', needsApprovalBecause: ['damaged item'] });

    const approved = await request(context.app).post(`/api/returns/${body.data.id}/approve`).set(auth(adminToken));
    const writeOffs = await context.db.selectFrom('write_offs').selectAll().execute();

    expect(approved.body.data.status).toBe('approved');
    expect(await stockOf(context, productId)).toBe(18);
    expect(writeOffs).toEqual([expect.objectContaining({ return_id: body.data.id, status: 'approved', quantity: 1, reason: 'damaged' })]);
  });

  it('should count pending returns against what is left', async () => {
    const saleId = await sell(employeeToken, 3, { saleDate: new Date(Date.now() - 20 * DAY).toISOString() });
    await returnSale(employeeToken, saleId, { quantity: 2, condition: 'resellable' });

    const tooMany = await returnSale(employeeToken, saleId, { quantity: 2, condition: 'resellable' });

    expect(tooMany.status).toBe(400);
    expect(tooMany.body.message).toContain('Only 1 left to return');
  });

  it('should not refund more than was paid', async () => {
    const saleId = await sell(employeeToken, 1);

    const response = await returnSale(employeeToken, saleId, { quantity: 1, condition: 'resellable', refundAmount: 11 });

    expect(response.status).toBe(400);
  });

  it('should allow a lower refund', async () => {
    const saleId = await sell(employeeToken, 1);

    const response = await returnSale(employeeToken, saleId, { quantity: 1, condition: 'resellable', refundAmount: 5 });

    expect(response.body.data).toMatchObject({ refundAmount: 5, status: 'approved' });
  });

  it("should not let employees return someone else's sale", async () => {
    const saleId = await sell(adminToken, 1);

    const response = await returnSale(employeeToken, saleId, { quantity: 1, condition: 'resellable' });

    expect(response.status).toBe(403);
  });

  it("should let the admin return anyone's sale straight away, even big or damaged ones", async () => {
    const saleId = await sell(employeeToken, 8);

    const response = await returnSale(adminToken, saleId, { quantity: 8, condition: 'damaged' });

    expect(response.body.data).toMatchObject({ status: 'approved', needsApprovalBecause: [] });
    expect(await stockOf(context, productId)).toBe(12);
  });

  it('should reject with a reason and tell the employee', async () => {
    const saleId = await sell(employeeToken, 8);
    const { body } = await returnSale(employeeToken, saleId, { quantity: 8, condition: 'resellable' });

    const rejected = await request(context.app)
      .post(`/api/returns/${body.data.id}/reject`)
      .set(auth(adminToken))
      .send({ note: 'Opened and used' });
    const employee = await context.db.selectFrom('users').select('id').where('role', '=', 'employee').executeTakeFirstOrThrow();
    const notes = await context.db.selectFrom('notifications').select('title').where('user_id', '=', employee.id).execute();

    expect(rejected.body.data).toMatchObject({ status: 'rejected', decisionNote: 'Opened and used' });
    expect(await stockOf(context, productId)).toBe(12);
    expect(notes.map((n) => n.title)).toEqual(['Your return of 8 × Oak Chair was rejected']);
  });

  it('should not decide twice', async () => {
    const saleId = await sell(employeeToken, 8);
    const { body } = await returnSale(employeeToken, saleId, { quantity: 8, condition: 'resellable' });
    await request(context.app).post(`/api/returns/${body.data.id}/approve`).set(auth(adminToken));

    const again = await request(context.app).post(`/api/returns/${body.data.id}/approve`).set(auth(adminToken));

    expect(again.status).toBe(409);
    expect(await stockOf(context, productId)).toBe(20);
  });

  it('should show how much of a sale was returned', async () => {
    const saleId = await sell(employeeToken, 2);
    await returnSale(employeeToken, saleId, { quantity: 1, condition: 'resellable' });

    const sales = await request(context.app).get('/api/sales').set(auth(adminToken));

    expect(sales.body.data.sales[0]).toMatchObject({ id: saleId, returnedQuantity: 1 });
  });

  it('should list pending returns with who sold and who asked', async () => {
    const other = await createTestUser(context.db, 'employee', { email: 'second@test.local' });
    const login = await request(context.app).post('/api/auth/login').send({ email: other.email, password: TEST_PASSWORD });
    const saleId = await sell(login.body.data.token, 8);
    await returnSale(login.body.data.token, saleId, { quantity: 8, condition: 'resellable' });

    const pending = await request(context.app).get('/api/returns?status=pending').set(auth(adminToken));

    expect(pending.body.data).toEqual([
      expect.objectContaining({ productName: 'Oak Chair', soldBy: { id: other.id, name: other.name }, needsApprovalBecause: ['refund over €50'] }),
    ]);
  });
});
