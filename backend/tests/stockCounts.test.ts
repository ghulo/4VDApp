import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestCategory,
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
let toolsId: number;
let paintId: number;
let hammer: number;
let saw: number;
let whitePaint: number;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
  employeeToken = await loginAs(context, 'employee');
  toolsId = (await createTestCategory(context.db, 'Tools')).id;
  paintId = (await createTestCategory(context.db, 'Paint')).id;
  saw = await createTestProduct(context, adminToken, { name: 'Saw', categoryId: toolsId, stock: 10, costPrice: 5 });
  hammer = await createTestProduct(context, adminToken, { name: 'Hammer', categoryId: toolsId, stock: 10, costPrice: 4 });
  whitePaint = await createTestProduct(context, adminToken, { name: 'White paint', categoryId: paintId, stock: 3 });
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);

async function startCount(token: string, categoryId: number | null = toolsId): Promise<number> {
  const response = await api().post('/api/stock-counts').set(auth(token)).send(categoryId === null ? {} : { categoryId });
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  return response.body.data.id as number;
}

const count = (token: string, countId: number, productId: number, countedQuantity: number) =>
  api().put(`/api/stock-counts/${countId}/lines/${productId}`).set(auth(token)).send({ countedQuantity });

const submit = (token: string, countId: number) => api().post(`/api/stock-counts/${countId}/submit`).set(auth(token));

describe('stock counts', () => {
  it('should start a count for a category and list its products alphabetically', async () => {
    const countId = await startCount(employeeToken);

    const response = await api().get(`/api/stock-counts/${countId}`).set(auth(employeeToken));

    expect(response.body.data).toMatchObject({ status: 'open', category: { id: toolsId, name: 'Tools' } });
    expect(response.body.data.lines.map((line: { productName: string }) => line.productName)).toEqual(['Hammer', 'Saw']);
    expect(response.body.data.totals).toMatchObject({ products: 2, counted: 0 });
  });

  it('should refuse a second count that overlaps', async () => {
    await startCount(employeeToken, null);

    const sameShop = await api().post('/api/stock-counts').set(auth(adminToken)).send({ categoryId: toolsId });

    expect(sameShop.status).toBe(409);
  });

  it('should allow counts of different categories at the same time', async () => {
    await startCount(employeeToken, toolsId);

    const paint = await api().post('/api/stock-counts').set(auth(adminToken)).send({ categoryId: paintId });

    expect(paint.status).toBe(201);
  });

  it('should hide expected numbers from employees until the count is closed', async () => {
    const countId = await startCount(employeeToken);
    await count(employeeToken, countId, saw, 7);

    const asEmployee = await api().get(`/api/stock-counts/${countId}`).set(auth(employeeToken));
    const asAdmin = await api().get(`/api/stock-counts/${countId}`).set(auth(adminToken));
    const employeeSaw = asEmployee.body.data.lines.find((line: { productId: number }) => line.productId === saw);
    const adminSaw = asAdmin.body.data.lines.find((line: { productId: number }) => line.productId === saw);

    expect(employeeSaw).toMatchObject({ countedQuantity: 7 });
    expect(employeeSaw).not.toHaveProperty('expectedQuantity');
    expect(asEmployee.body.data.totals.differences).toBeNull();
    expect(adminSaw).toMatchObject({ countedQuantity: 7, expectedQuantity: 10, difference: -3, value: -15 });
  });

  it('should replace a line when counted again', async () => {
    const countId = await startCount(employeeToken);
    await count(employeeToken, countId, saw, 7);

    await count(employeeToken, countId, saw, 9);
    const lines = await context.db.selectFrom('stock_count_lines').selectAll().execute();

    expect(lines).toEqual([expect.objectContaining({ product_id: saw, counted_quantity: 9 })]);
  });

  it('should refuse to count a product outside the count', async () => {
    const countId = await startCount(employeeToken);

    const response = await count(employeeToken, countId, whitePaint, 3);

    expect(response.status).toBe(400);
  });

  it('should sort matches from differences on submit and tell the admins', async () => {
    const countId = await startCount(employeeToken);
    await count(employeeToken, countId, saw, 10);
    await count(employeeToken, countId, hammer, 8);

    const submitted = await submit(employeeToken, countId);
    const lines = await context.db.selectFrom('stock_count_lines').select(['product_id', 'status']).orderBy('product_id').execute();
    const notes = await context.db.selectFrom('notifications').select('title').execute();

    expect(submitted.body.data.status).toBe('submitted');
    expect(lines).toEqual([
      { product_id: saw, status: 'match' },
      { product_id: hammer, status: 'pending' },
    ]);
    expect(await stockOf(context, hammer)).toBe(10);
    expect(notes.map((n) => n.title)).toContain('New stock count waiting for approval');
  });

  it('should close straight away when everything matched', async () => {
    const countId = await startCount(employeeToken);
    await count(employeeToken, countId, saw, 10);

    const submitted = await submit(employeeToken, countId);

    expect(submitted.body.data.status).toBe('closed');
  });

  it('should apply the difference so later sales are kept', async () => {
    const countId = await startCount(employeeToken);
    await count(employeeToken, countId, saw, 8);
    await submit(employeeToken, countId);
    await api().post('/api/sales').set(auth(adminToken)).send({ productId: saw, quantity: 1 });

    const approved = await api().post(`/api/stock-counts/${countId}/lines/${saw}/approve`).set(auth(adminToken));
    const adjustment = await context.db
      .selectFrom('stock_adjustments')
      .select(['adjustment_quantity', 'reason', 'notes'])
      .where('product_id', '=', saw)
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();

    expect(approved.status).toBe(200);
    expect(await stockOf(context, saw)).toBe(7);
    expect(adjustment).toEqual({ adjustment_quantity: -2, reason: 'Recount', notes: `Count #${countId}` });
  });

  it('should close the count once nothing is pending, with the shortage value', async () => {
    const countId = await startCount(employeeToken);
    await count(employeeToken, countId, saw, 8);
    await count(employeeToken, countId, hammer, 11);
    await submit(employeeToken, countId);

    const result = await api().post(`/api/stock-counts/${countId}/approve-all`).set(auth(adminToken));
    const detail = await api().get(`/api/stock-counts/${countId}`).set(auth(employeeToken));

    expect(result.body.data).toEqual({ approved: 2, failed: [] });
    expect(detail.body.data.status).toBe('closed');
    // Saw: 2 short at €5 = €10. Hammer: 1 over at €4 = -€4.
    expect(detail.body.data.totals.shortageValue).toBe(6);
    expect(await stockOf(context, saw)).toBe(8);
    expect(await stockOf(context, hammer)).toBe(11);
  });

  it('should leave stock alone for a rejected line', async () => {
    const countId = await startCount(employeeToken);
    await count(employeeToken, countId, saw, 8);
    await submit(employeeToken, countId);

    const rejected = await api()
      .post(`/api/stock-counts/${countId}/lines/${saw}/reject`)
      .set(auth(adminToken))
      .send({ note: 'Some were in the back room' });

    expect(rejected.body.data.status).toBe('closed');
    expect(await stockOf(context, saw)).toBe(10);
  });

  it('should refuse to approve a line that would make stock negative', async () => {
    const countId = await startCount(employeeToken);
    await count(employeeToken, countId, saw, 0);
    await submit(employeeToken, countId);
    await api().post('/api/sales').set(auth(adminToken)).send({ productId: saw, quantity: 5 });
    await api().post('/api/sales').set(auth(adminToken)).send({ productId: saw, quantity: 5 });

    const single = await api().post(`/api/stock-counts/${countId}/lines/${saw}/approve`).set(auth(adminToken));
    const all = await api().post(`/api/stock-counts/${countId}/approve-all`).set(auth(adminToken));

    expect(single.status).toBe(409);
    expect(all.body.data).toEqual({ approved: 0, failed: [expect.objectContaining({ productId: saw, productName: 'Saw' })] });
  });

  it('should not accept counts after submit', async () => {
    const countId = await startCount(employeeToken);
    await count(employeeToken, countId, saw, 10);
    await submit(employeeToken, countId);

    const late = await count(employeeToken, countId, hammer, 10);

    expect(late.status).toBe(409);
  });

  it('should only let the starter or an admin cancel an open count', async () => {
    const countId = await startCount(employeeToken);
    const other = await createTestUser(context.db, 'employee', { email: 'other@test.local' });
    const otherLogin = await api().post('/api/auth/login').send({ email: other.email, password: TEST_PASSWORD });

    const byOther = await api().post(`/api/stock-counts/${countId}/cancel`).set(auth(otherLogin.body.data.token));
    const byStarter = await api().post(`/api/stock-counts/${countId}/cancel`).set(auth(employeeToken));
    const afterwards = await api().post('/api/stock-counts').set(auth(adminToken)).send({ categoryId: toolsId });

    expect(byOther.status).toBe(403);
    expect(byStarter.body.data.status).toBe('cancelled');
    expect(afterwards.status).toBe(201);
  });

  it('should list open counts and not be available to family members', async () => {
    await startCount(employeeToken);
    const familyToken = await loginAs(context, 'family');

    const list = await api().get('/api/stock-counts').set(auth(employeeToken));
    const asFamily = await api().get('/api/stock-counts').set(auth(familyToken));

    expect(list.body.data).toEqual([expect.objectContaining({ status: 'open', category: { id: toolsId, name: 'Tools' } })]);
    expect(asFamily.status).toBe(403);
  });
});
