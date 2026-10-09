import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let employeeToken: string;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
  employeeToken = await loginAs(context, 'employee');
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });

async function openTab(name = 'Arben', token = employeeToken): Promise<number> {
  const response = await request(context.app).post('/api/customers').set(auth(token)).send({ name, phone: '044 123 456' });
  return response.body.data.id;
}

async function sellOnTab(customerId: number | undefined, quantity = 2, saleDate?: string) {
  const product = await createTestProduct(context, adminToken, { name: `Item ${Math.random()}`, price: 10, costPrice: 4, stock: 50 });
  return request(context.app).post('/api/sales').set(auth(employeeToken)).send({ productId: product, quantity, customerId, saleDate });
}

const detail = async (id: number) => (await request(context.app).get(`/api/customers/${id}`).set(auth(employeeToken))).body.data;

describe('customer tabs', () => {
  it('should put sales on a tab and pay off the oldest first', async () => {
    const arben = await openTab();
    await sellOnTab(arben, 2, '2026-09-01T10:00:00Z'); // €20
    await sellOnTab(arben, 3, '2026-09-10T10:00:00Z'); // €30

    expect((await detail(arben)).balance).toBe(50);
    const paid = await request(context.app).post(`/api/customers/${arben}/payments`).set(auth(employeeToken)).send({ amount: 25 });

    expect(paid.body.data.balance).toBe(25);
    // The first €20 charge is paid; the oldest still owing is the second one.
    expect(paid.body.data.owingSince).toBe('2026-09-10T10:00:00.000Z');
    expect(paid.body.data.entries[0]).toMatchObject({ kind: 'payment', amount: 25 });
  });

  it("should refuse paying more than they owe, and closing a tab that isn't settled", async () => {
    const arben = await openTab();
    await sellOnTab(arben, 1);

    expect((await request(context.app).post(`/api/customers/${arben}/payments`).set(auth(employeeToken)).send({ amount: 11 })).status).toBe(400);
    expect((await request(context.app).post(`/api/customers/${arben}/archive`).set(auth(adminToken))).status).toBe(409);
    await request(context.app).post(`/api/customers/${arben}/payments`).set(auth(employeeToken)).send({ amount: 10 });
    expect((await request(context.app).post(`/api/customers/${arben}/archive`).set(auth(employeeToken))).status).toBe(403);
    expect((await request(context.app).post(`/api/customers/${arben}/archive`).set(auth(adminToken))).status).toBe(200);
    expect((await sellOnTab(arben, 1)).status).toBe(404);
  });

  it('should drop the charge when its sale is undone, and bring it back on restore', async () => {
    const arben = await openTab();
    const sale = (await sellOnTab(arben, 2)).body.data;
    const entry = await context.db
      .selectFrom('activity_log')
      .select('id')
      .where('entity_type', '=', 'sale')
      .where('entity_id', '=', sale.id)
      .executeTakeFirstOrThrow();

    await request(context.app).post(`/api/activity/${entry.id}/undo`).set(auth(adminToken)).send({});
    expect((await detail(arben)).balance).toBe(0);
    await request(context.app).post(`/api/activity/${entry.id}/restore`).set(auth(adminToken));
    expect((await detail(arben)).balance).toBe(20);
  });

  it('should keep tab sales out of the cash check, and count tab payments in', async () => {
    const arben = await openTab();
    await sellOnTab(undefined, 3); // €30 paid in cash
    await sellOnTab(arben, 2); // €20 on the tab
    await request(context.app).post(`/api/customers/${arben}/payments`).set(auth(employeeToken)).send({ amount: 5 });

    const count = await request(context.app).post('/api/cash-counts').set(auth(adminToken)).send({ place: 'shop', counted: 85 });
    // €50 float + €30 cash sale + €5 tab payment.
    expect(count.body.data).toMatchObject({ expected: 35, difference: 0 });
    expect(today()).toBe(count.body.data.day);
  });

  it('should take a return of a tab sale off the tab instead of paying out cash, until the return is undone', async () => {
    const arben = await openTab();
    const sale = (await sellOnTab(arben, 3)).body.data; // €30 on the tab
    await request(context.app).post(`/api/sales/${sale.id}/returns`).set(auth(adminToken)).send({ quantity: 1, condition: 'resellable' });

    const after = await detail(arben);
    expect(after.balance).toBe(20);
    expect(after.entries[0]).toMatchObject({ kind: 'refund', amount: 10, undone: false });
    // No cash came in for the sale and none went out for the return.
    const count = await request(context.app).post('/api/cash-counts').set(auth(adminToken)).send({ place: 'shop', counted: 50 });
    expect(count.body.data).toMatchObject({ expected: 0, difference: 0 });

    const entry = await context.db
      .selectFrom('activity_log')
      .select('id')
      .where('action', '=', 'return.requested')
      .executeTakeFirstOrThrow();
    await request(context.app).post(`/api/activity/${entry.id}/undo`).set(auth(adminToken)).send({});
    expect((await detail(arben)).balance).toBe(30);
  });

  it('should pay out in cash only the part of a refund the tab no longer owes', async () => {
    const arben = await openTab();
    const sale = (await sellOnTab(arben, 2)).body.data; // €20 on the tab
    await request(context.app).post(`/api/customers/${arben}/payments`).set(auth(employeeToken)).send({ amount: 15 });
    await request(context.app).post(`/api/sales/${sale.id}/returns`).set(auth(adminToken)).send({ quantity: 2, condition: 'resellable' });

    // €5 comes off the tab, the other €15 goes back in cash: €15 paid in, €15 out.
    expect((await detail(arben)).balance).toBe(0);
    const count = await request(context.app).post('/api/cash-counts').set(auth(adminToken)).send({ place: 'shop', counted: 50 });
    expect(count.body.data).toMatchObject({ expected: 0, difference: 0 });
  });

  it('should flag tabs unpaid for 30 days in "Needs your attention"', async () => {
    const arben = await openTab('Arben');
    const besa = await openTab('Besa');
    await sellOnTab(arben, 4, '2026-08-01T10:00:00Z');
    await sellOnTab(besa, 1, '2026-09-25T10:00:00Z');

    const insights = await context.container.insightsService.list(new Date('2026-09-30T10:00:00Z'));
    const tabs = insights.filter((insight) => insight.kind === 'tab_overdue');

    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ customerId: arben, productId: null, title: 'Arben owes €40.00 on their tab' });
  });

  it('should list the most owed first', async () => {
    const arben = await openTab('Arben');
    const besa = await openTab('Besa');
    await openTab('Cen');
    await sellOnTab(arben, 1);
    await sellOnTab(besa, 5);

    const list = (await request(context.app).get('/api/customers').set(auth(employeeToken))).body.data;
    expect(list.map((customer: { name: string; balance: number }) => [customer.name, customer.balance])).toEqual([
      ['Besa', 50],
      ['Arben', 10],
      ['Cen', 0],
    ]);
  });
});
