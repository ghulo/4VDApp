import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, zonedDay } from '../src/utils/zonedDates.js';
import { shopTimeZone } from '../src/validators/operationsValidators.js';
import { createTestProduct, loginAs, resetData, setupTestApp, stockOf, type TestContext } from './helpers/testApp.js';

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

const api = () => request(context.app);
const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
/** The shop day `n` days from today. */
const day = (n: number) => addDays(zonedDay(new Date(), shopTimeZone()), n);

async function note(productId: number, quantity: number, expiresOn: string, extra: Record<string, unknown> = {}) {
  const response = await api().post('/api/expiry').set(auth()).send({ productId, quantity, expiresOn, ...extra });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data;
}

const checkout = (items: Array<Record<string, unknown>>, token = adminToken) =>
  api().post('/api/sales/basket').set(auth(token)).send({ items, notes: null });

const shortDated = async () => (await api().get('/api/expiry/short-dated').set(auth())).body.data;

describe('short-dated stock at the till', () => {
  it('should offer a batch close to its date at a discount that grows as the date nears', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 2, costPrice: 0.5, stock: 20 });
    await note(milk, 4, day(2));
    await note(milk, 4, day(10));

    const offers = await shortDated();

    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ productId: milk, remaining: 4, daysLeft: 2, shortDated: { percentOff: 30, price: 1.4 } });
  });

  it('should sell a stickered unit at the short-dated price, and stop once the batch is sold', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 2, costPrice: 0.5, stock: 20 });
    // 20 on the shelf but only 3 dated: the undated ones must not keep the discount going.
    const batch = await note(milk, 3, day(1));

    const sold = await checkout([
      { productId: milk, quantity: 2, shortDatedId: batch.id },
      { productId: milk, quantity: 1 },
    ]);

    expect(sold.status, JSON.stringify(sold.body)).toBe(201);
    expect(sold.body.data.sales.map((sale: { pricePerUnit: number; shortDatedPercent: number | null }) => [sale.pricePerUnit, sale.shortDatedPercent])).toEqual([
      [1, 50],
      [2, null],
    ]);
    expect((await shortDated())[0]).toMatchObject({ id: batch.id, remaining: 1 });

    const tooMany = await checkout([{ productId: milk, quantity: 2, shortDatedId: batch.id }]);
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.message).toContain('Only 1 × Milk are short-dated');

    expect((await checkout([{ productId: milk, quantity: 1, shortDatedId: batch.id }])).status).toBe(201);
    expect(await shortDated()).toHaveLength(0);
  });

  it('should never go below cost unless the shop allows it', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 2, costPrice: 1.6, stock: 10 });
    const batch = await note(milk, 5, day(0));

    expect((await shortDated())[0].shortDated).toEqual({ percentOff: 20, price: 1.6 });

    const changed = await api().put('/api/settings/rules').set(auth()).send({ shortDated: { belowCost: true } });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.data.shortDated).toMatchObject({ days: 3, belowCost: true });

    const sold = await checkout([{ productId: milk, quantity: 1, shortDatedId: batch.id }]);
    expect(sold.body.data.sales[0]).toMatchObject({ pricePerUnit: 1, shortDatedPercent: 50 });
  });

  it('should refuse a batch that is no longer short-dated', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 2, costPrice: 0.5, stock: 10 });
    const later = await note(milk, 5, day(20));
    const past = await note(milk, 5, day(-1));

    for (const batch of [later, past]) {
      const response = await checkout([{ productId: milk, quantity: 1, shortDatedId: batch.id }]);
      expect(response.status).toBe(400);
      expect(response.body.message).toContain('no longer sold short-dated');
    }
  });

  it('should keep a cheaper promotion instead (discounts never stack)', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 2, costPrice: 0.5, stock: 10 });
    const batch = await note(milk, 5, day(3));
    const promotion = await api()
      .post('/api/promotions')
      .set(auth())
      .send({ name: 'Half', percentOff: 50, productId: milk, startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(promotion.status, JSON.stringify(promotion.body)).toBe(201);

    const sold = await checkout([{ productId: milk, quantity: 1, shortDatedId: batch.id }]);

    expect(sold.body.data.sales[0]).toMatchObject({ pricePerUnit: 1, shortDatedPercent: null });
  });

  it('should use the category’s and the product’s own window', async () => {
    const category = (await api().post('/api/categories').set(auth()).send({ name: 'Bread', shortDatedDays: 1 })).body.data;
    expect(category.shortDatedDays).toBe(1);
    const bread = await createTestProduct(context, adminToken, { name: 'Bread', price: 1, costPrice: 0.2, stock: 10, categoryId: category.id });
    const cheese = await createTestProduct(context, adminToken, { name: 'Cheese', price: 5, costPrice: 1, stock: 10, categoryId: category.id, hasBestBefore: true, shortDatedDays: 10 });
    await note(bread, 2, day(2));
    await note(cheese, 2, day(8));

    expect((await shortDated()).map((offer: { productName: string; shortDated: { percentOff: number } }) => [offer.productName, offer.shortDated.percentOff])).toEqual([['Cheese', 20]]);
    expect((await api().get(`/api/products/${cheese}`).set(auth())).body.data).toMatchObject({ hasBestBefore: true, shortDatedDays: 10 });
  });
});

describe('best-before dates coming in', () => {
  it('should note dates from a stock in', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 2, costPrice: 0.5, stock: 0 });

    const stockIn = await api()
      .post('/api/stock-documents')
      .set(auth())
      .send({ direction: 'in', reason: 'found', day: day(0), lines: [{ productId: milk, quantity: 6, expiresOn: day(5) }] });

    expect(stockIn.status, JSON.stringify(stockIn.body)).toBe(201);
    const [expiry] = (await api().get('/api/expiry').set(auth()).query({ productId: milk })).body.data;
    expect(expiry).toMatchObject({ quantity: 6, expiresOn: day(5), note: stockIn.body.data.number });
  });

  it('should note dates from a bill line', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 2, costPrice: 0.5, stock: 0 });
    const supplier = (await api().post('/api/suppliers').set(auth()).send({ name: 'Fresh Foods', nui: '811234567' })).body.data.id;

    const bill = await api()
      .post('/api/bills')
      .set(auth())
      .send({ supplierId: supplier, issuedOn: day(0), dueOn: null, number: null, lines: [{ kind: 'product', productId: milk, quantity: 12, unitPrice: 0.6, expiresOn: day(4) }] });

    expect(bill.status, JSON.stringify(bill.body)).toBe(201);
    const [expiry] = (await api().get('/api/expiry').set(auth()).query({ productId: milk })).body.data;
    expect(expiry).toMatchObject({ quantity: 12, expiresOn: day(4) });
  });

  it('should let a count replace the dates noted before', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 2, costPrice: 0.5, stock: 10 });
    await note(milk, 5, day(1));
    await note(milk, 4, day(6), { replace: true });

    const open = (await api().get('/api/expiry').set(auth()).query({ productId: milk })).body.data;
    expect(open.map((expiry: { expiresOn: string }) => expiry.expiresOn)).toEqual([day(6)]);
  });
});

describe('past its date', () => {
  it('should write off what is left as expired and close the date', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 2, costPrice: 0.5, stock: 10 });
    const batch = await note(milk, 4, day(-1));

    const listed = (await api().get('/api/expiry').set(auth()).query({ days: 14 })).body.data;
    expect(listed[0]).toMatchObject({ remaining: 4, valueAtCost: 2, shortDated: null });

    const written = await api().post(`/api/expiry/${batch.id}/write-off`).set(auth());

    expect(written.status, JSON.stringify(written.body)).toBe(201);
    expect(written.body.data.quantity).toBe(4);
    expect(await stockOf(context, milk)).toBe(6);
    const writeOff = await context.db.selectFrom('write_offs').selectAll().where('id', '=', written.body.data.writeOffId).executeTakeFirstOrThrow();
    expect(writeOff).toMatchObject({ reason: 'expired', quantity: 4, status: 'approved' });
    expect((await api().get('/api/expiry').set(auth()).query({ productId: milk })).body.data).toHaveLength(0);
    expect((await api().post(`/api/expiry/${batch.id}/write-off`).set(auth())).status).toBe(409);
  });

  it('should let an employee ask, waiting for the owner', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 2, costPrice: 0.5, stock: 10 });
    const batch = await note(milk, 3, day(-2));
    const employeeToken = await loginAs(context, 'employee');

    const written = await api().post(`/api/expiry/${batch.id}/write-off`).set(auth(employeeToken));

    expect(written.status).toBe(201);
    expect(await stockOf(context, milk)).toBe(10);
    const writeOff = await context.db.selectFrom('write_offs').selectAll().where('id', '=', written.body.data.writeOffId).executeTakeFirstOrThrow();
    expect(writeOff.status).toBe('pending');
  });
});
