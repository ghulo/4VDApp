import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { createTestProduct, loginAs, resetData, setupTestApp, stockOf, type TestContext } from './helpers/testApp.js';

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
const sell = (items: Array<{ productId: number; quantity: number }>) => api().post('/api/sales/basket').set(auth(employeeToken)).send({ items, notes: null });

describe('products sold by the kilo', () => {
  it('sells to the gram, rounds the line to the cent and keeps stock to the gram', async () => {
    const cheese = await createTestProduct(context, adminToken, { name: 'Djathë i bardhë', price: 8.2, costPrice: 5, stock: 10.5, unit: 'kg', scalePlu: 1234 });
    const product = (await api().get(`/api/products/${cheese}`).set(auth())).body.data;
    expect(product).toMatchObject({ unit: 'kg', scalePlu: 1234 });
    expect(product.stock.quantity).toBe(10.5);

    const sale = await sell([{ productId: cheese, quantity: 0.775 }]);
    expect(sale.status).toBe(201);
    expect(sale.body.data.total).toBe(6.36);
    expect(sale.body.data.sales[0]).toMatchObject({ quantity: 0.775, totalAmount: 6.36 });
    expect(await stockOf(context, cheese)).toBe(9.725);

    // Three sales of 0.1 kg leave the stock exact, not 9.424999….
    for (let index = 0; index < 3; index++) expect((await sell([{ productId: cheese, quantity: 0.1 }])).status).toBe(201);
    expect(await stockOf(context, cheese)).toBe(9.425);
    expect((await api().patch(`/api/inventory/${cheese}`).set(auth()).send({ quantity: 1.25, reason: 'Restock' })).status).toBe(200);
    expect(await stockOf(context, cheese)).toBe(10.675);

    const shelf = (await api().get('/api/counter/shelf').set(auth(employeeToken))).body.data;
    expect(shelf.find((one: { id: number }) => one.id === cheese)).toMatchObject({ unit: 'kg', scalePlu: 1234, stock: expect.objectContaining({ quantity: 10.675 }) });
  });

  it('never sells, adjusts or starts part of a piece', async () => {
    const water = await createTestProduct(context, adminToken, { name: 'Ujë 0.5L', price: 0.5, stock: 10 });
    expect((await sell([{ productId: water, quantity: 0.5 }])).status).toBe(400);
    expect((await api().patch(`/api/inventory/${water}`).set(auth()).send({ quantity: 1.5, reason: 'Manual adjustment' })).status).toBe(400);
    expect((await api().patch(`/api/inventory/${water}`).set(auth()).send({ quantity: 2, reason: 'Manual adjustment' })).status).toBe(200);
    expect(await stockOf(context, water)).toBe(12);
    const category = (await context.db.selectFrom('categories').select('id').executeTakeFirstOrThrow()).id;
    expect((await api().post('/api/products').set(auth()).send({ name: 'Ujë 1L', price: 1, categoryId: category, stock: 2.5 })).status).toBe(400);
    // Grams beyond three decimals are refused for every product.
    expect((await sell([{ productId: water, quantity: 1.0001 }])).status).toBe(400);
  });

  it('gives each scale number to one product only', async () => {
    await createTestProduct(context, adminToken, { name: 'Mish viçi', price: 12, unit: 'kg', scalePlu: 7 });
    const category = (await context.db.selectFrom('categories').select('id').executeTakeFirstOrThrow()).id;
    const second = await api().post('/api/products').set(auth()).send({ name: 'Mish pule', price: 5, categoryId: category, unit: 'kg', scalePlu: 7 });
    expect(second.status).toBe(409);
    // A product sold by the piece has no scale number.
    const piece = await createTestProduct(context, adminToken, { name: 'Bukë', price: 0.4, unit: 'piece', scalePlu: 8 });
    expect((await api().get(`/api/products/${piece}`).set(auth())).body.data.scalePlu).toBeNull();
  });

  it('will not switch a product with part kilos in stock to the piece', async () => {
    const olives = await createTestProduct(context, adminToken, { name: 'Ullinj', price: 6, stock: 2.4, unit: 'kg' });
    const product = (await api().get(`/api/products/${olives}`).set(auth())).body.data;
    const back = await api()
      .put(`/api/products/${olives}`)
      .set(auth())
      .send({ name: product.name, description: null, categoryId: product.category.id, price: 6, costPrice: null, imageUrl: null, sku: null, isActive: true, unit: 'piece' });
    expect(back.status).toBe(400);
  });
});
