import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { levelPrice, listPrice } from '../src/services/pricing/salePrice.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let employeeToken: string;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  await seedBooks(context.db as never);
  adminToken = await loginAs(context, 'admin');
  employeeToken = await loginAs(context, 'employee');
});
afterAll(() => context.db.destroy());

const api = () => request(context.app);
const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const customer = async (body: Record<string, unknown>, token = adminToken) => (await api().post('/api/customers').set(auth(token)).send(body)).body.data;

describe('the price list rules', () => {
  const base = { shelfPrice: 2, wholesalePrice: 1.6, tiers: [{ quantity: 10, price: 1.5 }], quantity: 1, promotion: null };
  it('charges the wholesale price only when asked, and never more than the shelf price', () => {
    expect(levelPrice(2, 1.6, false)).toBe(2);
    expect(levelPrice(2, 1.6, true)).toBe(1.6);
    expect(levelPrice(2, 2.4, true)).toBe(2);
    expect(levelPrice(2, null, true)).toBe(2);
  });
  it('lets a lower bulk price or promotion win over the price level', () => {
    expect(listPrice({ ...base, wholesale: true })).toMatchObject({ pricePerUnit: 1.6, wholesale: true });
    expect(listPrice({ ...base, wholesale: true, quantity: 10 })).toMatchObject({ pricePerUnit: 1.5 });
    const promotion = { id: 1, name: 'Half', percentOff: 50, productId: null, categoryId: 1, endsAt: new Date() };
    expect(listPrice({ ...base, wholesale: true, promotion })).toMatchObject({ pricePerUnit: 1, promotionId: 1 });
    expect(listPrice({ ...base, wholesalePrice: 2.4, wholesale: true })).toMatchObject({ pricePerUnit: 2, wholesale: false });
  });
});

describe('wholesale prices at a sale', () => {
  it('a new business pays wholesale; a person does not, unless the owner switches it on', async () => {
    const shop = await customer({ name: 'Market Besa SH.P.K.', kind: 'business', nui: '811234567' });
    const person = await customer({ name: 'Arben' });
    expect(shop.paysWholesale).toBe(true);
    expect(person.paysWholesale).toBe(false);
    // A business opened at the till also starts with it on, but staff can't switch it.
    const atTill = await customer({ name: 'Kafe Dea', kind: 'business', nui: '811234568', paysWholesale: false }, employeeToken);
    expect(atTill.paysWholesale).toBe(true);
    const changed = await api().put(`/api/customers/${person.id}`).set(auth()).send({ name: 'Arben', paysWholesale: true });
    expect(changed.body.data.paysWholesale).toBe(true);
  });

  it('sells at the customer’s price, and the switch turns it on or off for one sale', async () => {
    const juice = await createTestProduct(context, adminToken, { name: 'Lëng 1L', price: 2, costPrice: 1.2, wholesalePrice: 1.6, stock: 50 });
    const shop = await customer({ name: 'Market Besa SH.P.K.', kind: 'business', nui: '811234567' });
    const sell = (body: Record<string, unknown>, token = employeeToken) =>
      api().post('/api/sales/basket').set(auth(token)).send({ items: [{ productId: juice, quantity: 2 }], notes: null, paidNow: true, ...body });

    const walkIn = await sell({});
    expect(walkIn.body.data.sales[0]).toMatchObject({ pricePerUnit: 2, wholesale: false });
    const business = await sell({ customerId: shop.id });
    expect(business.body.data.sales[0]).toMatchObject({ pricePerUnit: 1.6, wholesale: true });
    expect(business.body.data.total).toBe(3.2);
    // Anyone may charge a wholesale customer the shelf price.
    const off = await sell({ customerId: shop.id, wholesale: false });
    expect(off.body.data.sales[0]).toMatchObject({ pricePerUnit: 2, wholesale: false });
    // Only the owner's side may switch it on for someone who doesn't pay wholesale.
    expect((await sell({ wholesale: true })).status).toBe(403);
    const owner = await sell({ wholesale: true }, adminToken);
    expect(owner.status).toBe(201);
    expect(owner.body.data.sales[0]).toMatchObject({ pricePerUnit: 1.6, wholesale: true });
  });

  it('an offer for a wholesale customer compares with their wholesale price', async () => {
    const juice = await createTestProduct(context, adminToken, { name: 'Lëng 1L', price: 2, costPrice: 1.2, wholesalePrice: 1.6, stock: 50 });
    const shop = await customer({ name: 'Market Besa SH.P.K.', kind: 'business', nui: '811234567' });
    const offer = await api().post('/api/offers').set(auth()).send({ customerId: shop.id, lines: [{ productId: juice, quantity: 10, unitPrice: 1.5 }] });
    expect(offer.status).toBe(201);
    expect(offer.body.data.lines[0]).toMatchObject({ unitPrice: 1.5, shelfPrice: 1.6 });
  });
});
