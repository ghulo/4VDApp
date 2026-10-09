import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let supplierId: number;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
  supplierId = (await api().post('/api/suppliers').set(auth()).send({ name: 'Fresh Foods', nui: '811234567' })).body.data.id;
});
afterAll(() => context.db.destroy());

const api = () => request(context.app);
const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const day = (offset = 0) => new Date(Date.now() + offset * MS_PER_DAY).toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });

async function addBill(body: Record<string, unknown> = {}) {
  const response = await api()
    .post('/api/bills')
    .set(auth())
    .send({ supplierId, number: 'FF-1001', issuedOn: day(-10), dueOn: day(5), amount: 300, ...body });
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  return response.body.data;
}

const pay = (billId: number, body: Record<string, unknown>) =>
  api().post(`/api/bills/${billId}/payments`).set(auth()).send({ paidOn: day(), method: 'bank', ...body });

describe('supplier bills', () => {
  it('should track a bill from unpaid to partly paid to paid', async () => {
    const bill = await addBill();
    expect(bill).toMatchObject({ status: 'unpaid', amount: 300, paid: 0, left: 300, overdue: false, daysLeft: 5 });

    const partly = await pay(bill.id, { amount: 100 });
    expect(partly.body.data).toMatchObject({ status: 'partly_paid', paid: 100, left: 200 });

    expect((await pay(bill.id, { amount: 250 })).status).toBe(400);
    const paid = await pay(bill.id, { amount: 200, method: 'cash' });
    expect(paid.body.data).toMatchObject({ status: 'paid', left: 0, daysLeft: null });
    expect(paid.body.data.payments).toHaveLength(2);

    const open = await api().get('/api/bills?status=open').set(auth());
    expect(open.body.data).toEqual([]);
  });

  it('should show what is owed and overdue, per supplier, and raise it in the attention list', async () => {
    await addBill({ dueOn: day(-3), amount: 120 });
    await addBill({ number: 'FF-1002', amount: 80 });

    const summary = (await api().get('/api/bills/summary').set(auth())).body.data;
    expect(summary).toMatchObject({
      owed: 200,
      overdue: { count: 1, amount: 120 },
      dueSoon: { count: 1, amount: 80 },
      bySupplier: [{ name: 'Fresh Foods', owed: 200, overdue: 120, bills: 2 }],
    });

    const insights = (await api().get('/api/reports/insights').set(auth())).body.data as Array<{ kind: string; severity: string }>;
    expect(insights.find((insight) => insight.kind === 'bill_overdue')).toMatchObject({ severity: 'urgent' });
  });

  it('should void a mistaken payment, and only void a bill without payments', async () => {
    const bill = await addBill();
    const withPayment = (await pay(bill.id, { amount: 50 })).body.data;

    expect((await api().post(`/api/bills/${bill.id}/void`).set(auth()).send({ note: 'typo' })).status).toBe(409);
    const removed = await api().post(`/api/bills/${bill.id}/payments/${withPayment.payments[0].id}/void`).set(auth());
    expect(removed.body.data).toMatchObject({ status: 'unpaid', left: 300 });

    const voided = await api().post(`/api/bills/${bill.id}/void`).set(auth()).send({ note: 'entered twice' });
    expect(voided.body.data).toMatchObject({ status: 'void', left: 0, voidNote: 'entered twice' });
    expect((await pay(bill.id, { amount: 10 })).status).toBe(409);
  });

  it('should refuse a due date before the bill date and a payment in the future', async () => {
    const bad = await api().post('/api/bills').set(auth()).send({ supplierId, issuedOn: day(), dueOn: day(-1), amount: 5 });
    expect(bad.status).toBe(400);
    const bill = await addBill();
    expect((await pay(bill.id, { amount: 5, paidOn: day(2) })).status).toBe(400);
  });

  it('should save the bill together with the delivery it came with', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 1.2, costPrice: 0.8, stock: 0 });
    const order = (await api().post('/api/orders').set(auth()).send({ supplierId, lines: [{ productId: milk, quantity: 10, unitCost: 0.8 }] })).body
      .data;
    await api()
      .post(`/api/orders/${order.id}/receive`)
      .set(auth())
      .send({ lines: [{ lineId: order.lines[0].id, receivedQuantity: 10 }], bill: { number: 'FF-77', issuedOn: day(), dueOn: day(30), amount: 8 } });

    const bills = (await api().get('/api/bills').set(auth())).body.data;
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({ orderId: order.id, number: 'FF-77', amount: 8, supplier: { name: 'Fresh Foods' } });

    await pay(bills[0].id, { amount: 3 });
    const detail = (await api().get(`/api/orders/${order.id}`).set(auth())).body.data;
    expect(detail).toMatchObject({ status: 'received', closedBy: 'Test admin', bill: { number: 'FF-77', amount: 8, left: 5 } });
  });

  it('should take supplier payments from the drawer off what the cash check expects', async () => {
    const product = await createTestProduct(context, adminToken, { name: 'Item', price: 20, costPrice: 1, stock: 100 });
    await api().post('/api/sales').set(auth()).send({ productId: product, quantity: 5 }); // €100 in the till
    const bill = await addBill();
    await pay(bill.id, { amount: 30, method: 'drawer' });
    await pay(bill.id, { amount: 40, method: 'bank' }); // a transfer never touches the till

    const count = await api().post('/api/cash-counts').set(auth()).send({ place: 'shop', counted: 120 }); // float €50
    expect(count.body.data).toMatchObject({ expected: 70, difference: 0 });
  });

  it('should keep bills to the people who run the shop', async () => {
    const employee = await loginAs(context, 'employee');
    expect((await api().get('/api/bills').set(auth(employee))).status).toBe(403);
  });
});
