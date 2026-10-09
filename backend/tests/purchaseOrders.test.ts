import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

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

const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });

async function supplier(name = 'Fresh Foods') {
  return (await request(context.app).post('/api/suppliers').set(auth()).send({ name, nui: '811234567', phone: '044 000 111', email: '' })).body.data.id as number;
}

const stockOf = async (productId: number) =>
  (await request(context.app).get(`/api/inventory/${productId}`).set(auth())).body.data.quantity as number;

describe('supplier orders', () => {
  it('should put the delivered units into stock and close the order', async () => {
    const freshFoods = await supplier();
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 1.2, costPrice: 0.8, stock: 3 });
    const bread = await createTestProduct(context, adminToken, { name: 'Bread', price: 1, costPrice: 0.5, stock: 0 });

    const order = (
      await request(context.app)
        .post('/api/orders')
        .set(auth())
        .send({ supplierId: freshFoods, lines: [{ productId: milk, quantity: 24, unitCost: 0.8 }, { productId: bread, quantity: 10 }] })
    ).body.data;
    expect(order).toMatchObject({ status: 'open', total: 19.2 });

    const milkLine = order.lines.find((line: { productId: number }) => line.productId === milk);
    const breadLine = order.lines.find((line: { productId: number }) => line.productId === bread);
    // 20 milk came instead of 24, at a new price; the bread came as ordered.
    const received = await request(context.app)
      .post(`/api/orders/${order.id}/receive`)
      .set(auth())
      .send({
        updateCostPrices: true,
        lines: [
          { lineId: milkLine.id, receivedQuantity: 20, unitCost: 0.85 },
          { lineId: breadLine.id, receivedQuantity: 10 },
        ],
      });

    expect(received.body.data).toMatchObject({ status: 'received', total: 17 });
    expect(await stockOf(milk)).toBe(23);
    expect(await stockOf(bread)).toBe(10);
    const product = (await request(context.app).get(`/api/products/${milk}`).set(auth())).body.data;
    expect(product.costPrice).toBe(0.85);
    const adjustment = await context.db.selectFrom('stock_adjustments').select(['reason', 'notes']).where('product_id', '=', milk).orderBy('id', 'desc').executeTakeFirstOrThrow();
    expect(adjustment).toEqual({ reason: 'Delivery', notes: `Order #${order.id} from Fresh Foods` });

    expect((await request(context.app).post(`/api/orders/${order.id}/receive`).set(auth()).send({ lines: [] })).status).toBe(409);
  });

  it('should leave cost prices alone unless asked, and cancel open orders', async () => {
    const freshFoods = await supplier();
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 1.2, costPrice: 0.8, stock: 0 });
    const order = (await request(context.app).post('/api/orders').set(auth()).send({ supplierId: freshFoods, lines: [{ productId: milk, quantity: 5, unitCost: 1 }] })).body.data;
    await request(context.app).post(`/api/orders/${order.id}/receive`).set(auth()).send({ lines: [{ lineId: order.lines[0].id, receivedQuantity: 5, unitCost: 1 }] });
    expect((await request(context.app).get(`/api/products/${milk}`).set(auth())).body.data.costPrice).toBe(0.8);

    const second = (await request(context.app).post('/api/orders').set(auth()).send({ supplierId: freshFoods, lines: [{ productId: milk, quantity: 5 }] })).body.data;
    expect((await request(context.app).post(`/api/orders/${second.id}/cancel`).set(auth())).body.data.status).toBe('cancelled');
    expect(await stockOf(milk)).toBe(5);

    const usual = (await request(context.app).get('/api/orders/usual-suppliers').set(auth())).body.data;
    expect(usual[milk]).toBe(freshFoods);
  });

  it('should let anyone at the counter tick off a delivery, without seeing or changing costs', async () => {
    const freshFoods = await supplier();
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 1.2, costPrice: 0.8, stock: 2 });
    const order = (await request(context.app).post('/api/orders').set(auth()).send({ supplierId: freshFoods, lines: [{ productId: milk, quantity: 12, unitCost: 0.9 }] })).body.data;
    const employeeToken = await loginAs(context, 'employee');

    expect((await request(context.app).get('/api/orders').set(auth(employeeToken))).status).toBe(403);
    const deliveries = (await request(context.app).get('/api/orders/deliveries').set(auth(employeeToken))).body.data;
    expect(deliveries).toEqual([
      {
        id: order.id,
        supplierName: 'Fresh Foods',
        note: null,
        createdAt: order.createdAt,
        lines: [{ id: order.lines[0].id, productId: milk, productName: 'Milk', sku: order.lines[0].sku, quantity: 12 }],
      },
    ]);

    // Costs sent from the counter are ignored: the ordered cost stands and the product's cost price stays.
    const received = await request(context.app)
      .post(`/api/orders/${order.id}/receive`)
      .set(auth(employeeToken))
      .send({ updateCostPrices: true, lines: [{ lineId: order.lines[0].id, receivedQuantity: 10, unitCost: 0.01, expiresOn: '2027-01-15' }] });

    expect(received.body.data).toEqual({ id: order.id, status: 'received' });
    expect(await stockOf(milk)).toBe(12);
    expect((await request(context.app).get(`/api/products/${milk}`).set(auth())).body.data.costPrice).toBe(0.8);
    expect((await request(context.app).get('/api/orders').set(auth())).body.data[0]).toMatchObject({ total: 9 });
    const dates = (await request(context.app).get('/api/expiry').set(auth(employeeToken)).query({ productId: milk })).body.data;
    expect(dates).toMatchObject([{ expiresOn: '2027-01-15', quantity: 10 }]);
    expect((await request(context.app).get('/api/orders/deliveries').set(auth(employeeToken))).body.data).toEqual([]);
  });

  it('should let the owner look but only managers order', async () => {
    const freshFoods = await supplier();
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 1.2, stock: 0 });
    const ownerToken = await loginAs(context, 'owner');

    expect((await request(context.app).get('/api/orders').set(auth(ownerToken))).status).toBe(200);
    expect((await request(context.app).post('/api/orders').set(auth(ownerToken)).send({ supplierId: freshFoods, lines: [{ productId: milk, quantity: 1 }] })).status).toBe(403);
    expect((await request(context.app).post('/api/orders').set(auth()).send({ supplierId: freshFoods, lines: [] })).status).toBe(400);
    expect(
      (await request(context.app).post('/api/orders').set(auth()).send({ supplierId: freshFoods, lines: [{ productId: milk, quantity: 1 }, { productId: milk, quantity: 2 }] })).status,
    ).toBe(400);
  });
});
