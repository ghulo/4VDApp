import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestProduct, loginAs, resetData, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers/testApp.js';

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
const inDays = (days: number) => {
  const date = new Date(`${today()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

async function customer(name = 'Arben', extra: Record<string, unknown> = {}): Promise<number> {
  const response = await request(context.app).post('/api/customers').set(auth(adminToken)).send({ name, phone: '044 123 456', ...extra });
  return response.body.data.id;
}

const product = (price = 10) => createTestProduct(context, adminToken, { name: `Item ${Math.random()}`, price, costPrice: 4, stock: 50 });
const basket = (token: string, body: Record<string, unknown>) => request(context.app).post('/api/sales/basket').set(auth(token)).send(body);
const detail = async (id: number) => (await request(context.app).get(`/api/customers/${id}`).set(auth(adminToken))).body.data;

describe('pay later', () => {
  it('lets the counter put a sale on a tab only for customers the owner allowed, within their limit', async () => {
    const item = await product();
    const arben = await customer();
    const refused = await basket(employeeToken, { items: [{ productId: item, quantity: 2 }], notes: null, customerId: arben, paidNow: false });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toContain('Ask the owner');
    // Nothing was kept from the refused sale.
    expect((await detail(arben)).balance).toBe(0);

    await request(context.app).put(`/api/customers/${arben}`).set(auth(adminToken)).send({ name: 'Arben', payLater: true, creditLimit: 50 });
    const first = await basket(employeeToken, { items: [{ productId: item, quantity: 2 }], notes: null, customerId: arben, paidNow: false, dueDate: inDays(10) });
    expect(first.status).toBe(201);
    const invoice = await context.db.selectFrom('documents').select([sql<string>`to_char(due_date, 'YYYY-MM-DD')`.as('due_date'), 'payment_method']).where('id', '=', first.body.data.invoice.id).executeTakeFirstOrThrow();
    expect(invoice).toEqual({ due_date: inDays(10), payment_method: 'account' });

    // €20 owed, €40 more would make €60, over the €50 limit.
    const over = await basket(employeeToken, { items: [{ productId: item, quantity: 4 }], notes: null, customerId: arben, paidNow: false });
    expect(over.status).toBe(403);
    expect(over.body.message).toContain('at most €50.00');
    expect((await detail(arben)).balance).toBe(20);
    // The owner's side isn't held to the limit.
    expect((await basket(adminToken, { items: [{ productId: item, quantity: 4 }], notes: null, customerId: arben, paidNow: false })).status).toBe(201);
  });

  it('takes an owner’s PIN yes once, for that customer and amount', async () => {
    const item = await product();
    const arben = await customer();
    const admin = await context.db.selectFrom('users').select('id').where('role', '=', 'admin').executeTakeFirstOrThrow();
    await request(context.app).put('/api/me/pin').set(auth(adminToken)).send({ password: TEST_PASSWORD, pin: '4321' });
    const ask = (amount: number) =>
      request(context.app).post('/api/counter/pay-later-approvals').set(auth(employeeToken)).send({ userId: admin.id, pin: '4321', customerId: arben, amount, basketId: 'b1' });

    const small = await ask(10);
    expect(small.status).toBe(201);
    // A yes for €10 doesn't cover a €20 sale.
    const tooMuch = await basket(employeeToken, { items: [{ productId: item, quantity: 2 }], notes: null, customerId: arben, paidNow: false, payLaterApproval: small.body.data.token });
    expect(tooMuch.status).toBe(403);

    const yes = await ask(20);
    const sold = await basket(employeeToken, { items: [{ productId: item, quantity: 2 }], notes: null, customerId: arben, paidNow: false, payLaterApproval: yes.body.data.token });
    expect(sold.status).toBe(201);
    const again = await basket(employeeToken, { items: [{ productId: item, quantity: 1 }], notes: null, customerId: arben, paidNow: false, payLaterApproval: yes.body.data.token });
    expect(again.status).toBe(403);
    const event = await context.db.selectFrom('counter_events').select(['kind', 'amount']).where('kind', '=', 'pay_later_allowed').execute();
    expect(event).toHaveLength(2);
  });

  it('counts a customer late only after the day they promised', async () => {
    const item = await product();
    const arben = await customer('Arben', { payLater: true });
    const sold = await basket(adminToken, { items: [{ productId: item, quantity: 3 }], notes: null, customerId: arben, paidNow: false, dueDate: inDays(5) });
    expect((await detail(arben)).lateAmount).toBe(0);
    expect((await basket(adminToken, { items: [{ productId: item, quantity: 1 }], notes: null, customerId: arben, paidNow: false, dueDate: inDays(-1) })).status).toBe(400);

    await context.db.updateTable('documents').set({ due_date: inDays(-3) } as never).where('id', '=', sold.body.data.invoice.id).execute();
    const late = await detail(arben);
    expect(late).toMatchObject({ lateAmount: 30, lateSince: inDays(-3) });
    const todo = await request(context.app).get('/api/reports/insights').set(auth(adminToken));
    const insight = (todo.body.data as Array<{ kind: string; title: string }>).find((entry) => entry.kind === 'tab_overdue');
    expect(insight?.title).toContain('late paying');
  });
});

describe('offers', () => {
  it('sells an offer at its prices once, then it is marked sold', async () => {
    const item = await product(10);
    const made = await request(context.app)
      .post('/api/offers')
      .set(auth(adminToken))
      .send({ partyName: 'Kafe Te Ura', partyPhone: '049 111 222', lines: [{ productId: item, quantity: 12, unitPrice: 8.35 }] });
    expect(made.status).toBe(201);
    expect(made.body.data).toMatchObject({ number: `OF-${today().slice(0, 4)}-000001`, name: 'Kafe Te Ura', total: 100.2, saving: 19.8, status: 'open' });
    // The counter can't make offers.
    expect((await request(context.app).post('/api/offers').set(auth(employeeToken)).send({ partyName: 'X', lines: [{ productId: item, quantity: 1, unitPrice: 1 }] })).status).toBe(403);

    const offerId = made.body.data.id;
    const wrongPrice = await basket(employeeToken, { items: [{ productId: item, quantity: 12, offerPrice: 7 }], notes: null, offerId });
    expect(wrongPrice.status).toBe(400);
    const sold = await basket(employeeToken, { items: [{ productId: item, quantity: 12, offerPrice: 8.35 }], notes: null, offerId });
    expect(sold.status).toBe(201);
    expect(sold.body.data.total).toBe(100.2);

    const offer = (await request(context.app).get(`/api/offers/${offerId}`).set(auth(employeeToken))).body.data;
    expect(offer).toMatchObject({ status: 'sold', sale: { id: sold.body.data.invoice.id } });
    expect((await basket(employeeToken, { items: [{ productId: item, quantity: 1, offerPrice: 8.35 }], notes: null, offerId })).status).toBe(409);
    expect((await request(context.app).post(`/api/offers/${offerId}/decline`).set(auth(adminToken))).status).toBe(409);
  });
});

describe('deliveries', () => {
  const delivery = (extra: Record<string, unknown>) => ({ name: 'Drita', phone: '044 999 888', address: 'Rr. Agim Ramadani 12, Prishtinë', day: today(), timeFrom: '16:00', timeTo: '18:00', note: null, ...extra });

  it('takes part now, collects the rest at the door into the till, and only then', async () => {
    const item = await product(10);
    const sold = await basket(employeeToken, { items: [{ productId: item, quantity: 3 }], notes: null, delivery: delivery({ payment: 'door', paidNow: 9 }) });
    expect(sold.status).toBe(201);
    // A customer was made from the delivery, owing what is left.
    const drita = await context.db.selectFrom('customers').select(['id', 'address']).where('name', '=', 'Drita').executeTakeFirstOrThrow();
    expect(drita.address).toContain('Agim Ramadani');
    expect((await detail(drita.id)).balance).toBe(21);

    const list = (await request(context.app).get('/api/deliveries').set(auth(employeeToken))).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'waiting', toCollect: 21, total: 30, lines: [{ quantity: 3 }] });

    const id = list[0].id;
    expect((await request(context.app).post(`/api/deliveries/${id}/take`).set(auth(employeeToken))).body.data.status).toBe('on_the_way');
    // Someone else can't take one already on its way.
    expect((await request(context.app).post(`/api/deliveries/${id}/take`).set(auth(adminToken))).status).toBe(409);
    expect((await request(context.app).post(`/api/deliveries/${id}/delivered`).set(auth(employeeToken)).send({ collected: 30 })).status).toBe(400);
    const done = await request(context.app).post(`/api/deliveries/${id}/delivered`).set(auth(employeeToken)).send({ collected: 21 });
    expect(done.body.data).toMatchObject({ status: 'delivered', collected: 21 });
    expect((await detail(drita.id)).balance).toBe(0);
    const remembered = await request(context.app).get(`/api/deliveries/last-address?customerId=${drita.id}`).set(auth(employeeToken));
    expect(remembered.body.data.address).toContain('Agim Ramadani');
  });

  it('puts a missed one back on the list with the reason', async () => {
    const item = await product(10);
    await basket(employeeToken, { items: [{ productId: item, quantity: 1 }], notes: null, delivery: delivery({ payment: 'shop' }) });
    const [one] = (await request(context.app).get('/api/deliveries').set(auth(employeeToken))).body.data;
    expect(one.toCollect).toBe(0);
    await request(context.app).post(`/api/deliveries/${one.id}/take`).set(auth(employeeToken));
    const missed = await request(context.app).post(`/api/deliveries/${one.id}/missed`).set(auth(employeeToken)).send({ reason: 'Nobody home', day: inDays(1) });
    expect(missed.body.data).toMatchObject({ status: 'waiting', takenBy: null, lastFailure: 'Nobody home', failures: 1, day: inDays(1) });
  });
});
