import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

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
  productId = await createTestProduct(context, adminToken, { price: 100, costPrice: 60, stock: 50 });
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);
const MARCH = 'startDate=2026-03-01&endDate=2026-03-31';
const APRIL = 'startDate=2026-04-01&endDate=2026-04-30';

async function sell(token: string, quantity: number, saleDate = '2026-03-10T12:00:00Z'): Promise<number> {
  const response = await api().post('/api/sales').set(auth(token)).send({ productId, quantity, saleDate });
  return response.body.data.id as number;
}

/** Return as admin (approved straight away), then move the approval into April. */
async function refundInApril(saleId: number, body: Record<string, unknown>) {
  const response = await api().post(`/api/sales/${saleId}/returns`).set(auth(adminToken)).send(body);
  await context.db
    .updateTable('returns')
    .set({ decided_at: new Date('2026-04-05T12:00:00Z') })
    .where('id', '=', response.body.data.id)
    .execute();
}

describe('reports with returns and losses', () => {
  it('should take a refund off the period it was approved in', async () => {
    const saleId = await sell(adminToken, 2);
    await refundInApril(saleId, { quantity: 1, condition: 'resellable' });

    const march = await api().get(`/api/reports/summary?${MARCH}`).set(auth(adminToken));
    const april = await api().get(`/api/reports/summary?${APRIL}`).set(auth(adminToken));

    expect(march.body.data.current).toMatchObject({ revenue: 200, refunds: 0, profit: 80, salesCount: 1, unitsSold: 2 });
    expect(april.body.data.current).toMatchObject({ revenue: -100, refunds: 100, profit: -40, salesCount: 0, unitsSold: -1 });
  });

  it('should lower profit only by the margin on a full refund of restocked goods', async () => {
    const saleId = await sell(adminToken, 1, new Date(Date.now() - 60_000).toISOString());
    await api().post(`/api/sales/${saleId}/returns`).set(auth(adminToken)).send({ quantity: 1, condition: 'resellable' });
    const today = new Date();
    const range = `startDate=${new Date(today.getTime() - 86_400_000).toISOString()}&endDate=${new Date(today.getTime() + 60_000).toISOString()}`;

    const summary = await api().get(`/api/reports/summary?${range}`).set(auth(adminToken));

    expect(summary.body.data.current).toMatchObject({ revenue: 0, refunds: 100, profit: 0, cost: 0 });
  });

  it('should charge refunds to the original seller in the team report', async () => {
    const saleId = await sell(employeeToken, 1);
    await refundInApril(saleId, { quantity: 1, condition: 'resellable', refundAmount: 30 });

    const team = await api().get(`/api/reports/team?${APRIL}`).set(auth(adminToken));

    expect(team.body.data).toContainEqual(expect.objectContaining({ name: 'Test employee', revenue: -30, refunds: 30, salesCount: 0 }));
  });

  it('should take refunds off the profit by product', async () => {
    const saleId = await sell(adminToken, 2);
    await refundInApril(saleId, { quantity: 2, condition: 'resellable' });

    const profit = await api().get(`/api/reports/profit?${APRIL}`).set(auth(adminToken));

    expect(profit.body.data).toEqual([expect.objectContaining({ id: productId, unitsSold: -2, revenue: -200, profit: -80 })]);
  });

  it('should value stock losses from write-offs and count differences, and let a surplus reduce them', async () => {
    const other = await createTestProduct(context, adminToken, { name: 'Brush', price: 5, costPrice: 2, stock: 10 });
    await api().post('/api/write-offs').set(auth(adminToken)).send({ productId, quantity: 2, reason: 'damaged' });
    const count = await api().post('/api/stock-counts').set(auth(adminToken)).send({});
    await api().put(`/api/stock-counts/${count.body.data.id}/lines/${other}`).set(auth(adminToken)).send({ countedQuantity: 13 });
    await api().post(`/api/stock-counts/${count.body.data.id}/submit`).set(auth(adminToken));
    await api().post(`/api/stock-counts/${count.body.data.id}/approve-all`).set(auth(adminToken));
    const range = `startDate=${new Date(Date.now() - 3_600_000).toISOString()}&endDate=${new Date(Date.now() + 60_000).toISOString()}`;

    const summary = await api().get(`/api/reports/summary?${range}`).set(auth(adminToken));

    // 2 × €60 written off, minus 3 × €2 found in the count.
    expect(summary.body.data.current).toMatchObject({ stockLosses: 114, lossUnitsWithoutCost: 0 });
  });

  it("should show refunds in an employee's own numbers", async () => {
    const saleId = await sell(employeeToken, 1);
    await refundInApril(saleId, { quantity: 1, condition: 'resellable' });

    const mine = await api()
      .get(`/api/reports/my-sales?${APRIL}&previousStartDate=2026-03-01&previousEndDate=2026-03-31`)
      .set(auth(employeeToken));

    expect(mine.body.data.current).toEqual({ salesCount: 0, unitsSold: -1, revenue: -100, refunds: 100 });
    expect(mine.body.data.previous).toMatchObject({ revenue: 100, refunds: 0 });
  });

  it('should give the app what it needs to offer a return from recent sales', async () => {
    const saleId = await sell(employeeToken, 3, new Date(Date.now() - 60_000).toISOString());
    await api().post(`/api/sales/${saleId}/returns`).set(auth(employeeToken)).send({ quantity: 1, condition: 'resellable' });
    const range = `startDate=${new Date(Date.now() - 86_400_000).toISOString()}&endDate=${new Date(Date.now() + 60_000).toISOString()}`;

    const mine = await api().get(`/api/reports/my-sales?${range}`).set(auth(employeeToken));

    expect(mine.body.data.recentSales[0]).toMatchObject({ id: saleId, quantity: 3, pricePerUnit: 100, returnedQuantity: 1 });
  });

  it('should list approved returns as negative rows in the sales export', async () => {
    const saleId = await sell(adminToken, 2);
    await refundInApril(saleId, { quantity: 1, condition: 'resellable' });

    const csv = await api().get(`/api/exports/sales.csv?${APRIL}`).set(auth(adminToken));

    expect(csv.text.split('\r\n')[0]).toContain(',Type');
    expect(csv.text).toContain('\r\n2026-04-05 12:00,Oak Chair,,-1,100,-100,60,-40,Test admin,,Return');
  });

  it('should no longer accept Damage as a manual stock reason', async () => {
    const response = await api()
      .patch(`/api/inventory/${productId}`)
      .set(auth(adminToken))
      .send({ quantity: -1, reason: 'Damage' });

    expect(response.status).toBe(400);
  });
});
