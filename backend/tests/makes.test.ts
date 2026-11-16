import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { createTestProduct, loginAs, resetData, setupTestApp, stockOf, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  await seedBooks(context.db as never);
  adminToken = await loginAs(context, 'admin');
});
afterAll(() => context.db.destroy());

const auth = () => ({ Authorization: `Bearer ${adminToken}` });
const api = () => request(context.app);
const today = () => new Date().toISOString().slice(0, 10);
const switchOn = () => api().put('/api/settings/rules').set(auth()).send({ features: { recipes: true } });
const at = async (productId: number, locationId: number) =>
  (await context.db.selectFrom('location_stock').select('quantity').where('product_id', '=', productId).where('location_id', '=', locationId).executeTakeFirst())?.quantity ?? 0;
const costOf = async (productId: number) => {
  const row = await context.db.selectFrom('products').select('cost_price').where('id', '=', productId).executeTakeFirstOrThrow();
  return row.cost_price === null ? null : Number(row.cost_price);
};
const ledgerEntries = async () => Number((await context.db.selectFrom('ledger_entries').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow()).n);

async function setUp() {
  await switchOn();
  const depo = (await api().post('/api/locations').set(auth()).send({ name: 'Depo' })).body.data.id as number;
  const rakia = await createTestProduct(context, adminToken, { name: 'Rakia', price: 9, costPrice: 5, stock: 0 });
  const honey = await createTestProduct(context, adminToken, { name: 'Mjaltë', price: 6, costPrice: 3.4, stock: 0 });
  const basket = await createTestProduct(context, adminToken, { name: 'Shportë dhuratë', price: 15, costPrice: null, stock: 0 });
  const stockIn = await api()
    .post('/api/stock-documents')
    .set(auth())
    .send({ direction: 'in', reason: 'found', day: today(), locationId: depo, lines: [{ productId: rakia, quantity: 12 }, { productId: honey, quantity: 12, expiresOn: '2027-03-01' }] });
  expect(stockIn.status).toBe(201);
  expect((await api().put(`/api/makes/recipes/${basket}`).set(auth()).send({ parts: [{ productId: rakia, quantity: 1 }, { productId: honey, quantity: 1 }] })).status).toBe(200);
  return { depo, rakia, honey, basket };
}

describe('made products', () => {
  it('stays off until switched on', async () => {
    const basket = await createTestProduct(context, adminToken, { name: 'Shportë', price: 15, stock: 0 });
    const part = await createTestProduct(context, adminToken, { name: 'Pjesë', price: 1, stock: 0 });
    expect((await api().put(`/api/makes/recipes/${basket}`).set(auth()).send({ parts: [{ productId: part, quantity: 1 }] })).status).toBe(400);
  });

  it('refuses a recipe that goes round in a circle', async () => {
    const { rakia, basket } = await setUp();
    const circle = await api().put(`/api/makes/recipes/${rakia}`).set(auth()).send({ parts: [{ productId: basket, quantity: 1 }] });
    expect(circle.status).toBe(400);
    expect(circle.body.message).toContain('made from Rakia');
    expect((await api().put(`/api/makes/recipes/${basket}`).set(auth()).send({ parts: [{ productId: basket, quantity: 1 }] })).status).toBe(400);
  });

  it('takes the parts from the location, adds the made product there at their cost, and writes nothing in the books', async () => {
    const { depo, rakia, honey, basket } = await setUp();
    const plan = (await api().get('/api/makes/plan').set(auth()).query({ productId: basket, quantity: 10, locationId: depo })).body.data;
    expect(plan).toMatchObject({ unitCost: 8.4, locationName: 'Depo', noCost: [], short: [], earliestExpiry: '2027-03-01' });
    expect(plan.parts.map((part: { name: string; needed: number; atLocation: number }) => [part.name, part.needed, part.atLocation])).toEqual([
      ['Rakia', 10, 12],
      ['Mjaltë', 10, 12],
    ]);

    const entriesBefore = await ledgerEntries();
    const made = await api().post('/api/makes').set(auth()).send({ productId: basket, quantity: 10, day: today(), locationId: depo, expiresOn: plan.earliestExpiry });
    expect(made.status).toBe(201);
    expect(made.body.data).toMatchObject({ number: `PR-${today().slice(0, 4)}-000001`, quantity: 10, unitCost: 8.4, value: 84, locationName: 'Depo', expiresOn: '2027-03-01' });
    expect(made.body.data.lines).toHaveLength(2);
    expect(await at(rakia, depo)).toBe(2);
    expect(await at(honey, depo)).toBe(2);
    expect(await at(basket, depo)).toBe(10);
    expect(await costOf(basket)).toBe(8.4);
    await api().get('/api/books/entries').set(auth());
    expect(await ledgerEntries()).toBe(entriesBefore);
    const dated = await context.db.selectFrom('expiry_dates').select(['quantity']).where('product_id', '=', basket).execute();
    expect(dated).toEqual([{ quantity: 10 }]);

    // Too few parts: refused, nothing moves.
    const tooMany = await api().post('/api/makes').set(auth()).send({ productId: basket, quantity: 5, day: today(), locationId: depo });
    expect(tooMany.status).toBe(400);
    expect(await at(basket, depo)).toBe(10);

    // Voiding puts it all back and restores the cost.
    const voided = await api().post(`/api/makes/${made.body.data.id}/void`).set(auth());
    expect(voided.status).toBe(200);
    expect(await stockOf(context, basket)).toBe(0);
    expect(await at(rakia, depo)).toBe(12);
    expect(await costOf(basket)).toBeNull();
  });

  it('refuses a part with no cost, and a void once the made units are sold', async () => {
    const { depo, honey, basket } = await setUp();
    await context.db.updateTable('products').set({ cost_price: null }).where('id', '=', honey).execute();
    const refused = await api().post('/api/makes').set(auth()).send({ productId: basket, quantity: 1, day: today(), locationId: depo });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('Set the cost of Mjaltë first');

    await context.db.updateTable('products').set({ cost_price: '3.40' }).where('id', '=', honey).execute();
    const made = await api().post('/api/makes').set(auth()).send({ productId: basket, quantity: 2, day: today(), locationId: depo });
    expect(made.status).toBe(201);
    const sold = await api().post('/api/stock-documents').set(auth()).send({ direction: 'out', reason: 'given_away', day: today(), locationId: depo, lines: [{ productId: basket, quantity: 2 }] });
    expect(sold.status).toBe(201);
    expect((await api().post(`/api/makes/${made.body.data.id}/void`).set(auth())).status).toBe(409);
  });
});
