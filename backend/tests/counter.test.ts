import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { gtinCheckDigit, hasValidCheckDigit, inStoreBarcode } from '../src/utils/barcodes.js';
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

const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });

describe('barcodes', () => {
  it('should work out EAN-13 check digits', () => {
    expect(gtinCheckDigit('400638133393')).toBe(1); // a real EAN-13: 4006381333931
    expect(hasValidCheckDigit('4006381333931')).toBe(true);
    expect(hasValidCheckDigit('4006381333932')).toBe(false);
    expect(hasValidCheckDigit('ABC-123')).toBe(true);
    expect(inStoreBarcode(42)).toMatch(/^200000000042\d$/);
    expect(hasValidCheckDigit(inStoreBarcode(42))).toBe(true);
  });

  it('should set a manufacturer barcode, find the product by scanning it, and refuse duplicates or typos', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 1.2, stock: 5 });
    const bread = await createTestProduct(context, adminToken, { name: 'Bread', price: 1, stock: 5 });

    expect((await request(context.app).put(`/api/products/${milk}/barcode`).set(auth()).send({ barcode: '4006381333931' })).status).toBe(200);
    const scanned = await request(context.app).get('/api/products/barcode/4006381333931').set(auth(employeeToken));
    expect(scanned.body.data).toMatchObject({ id: milk, name: 'Milk', barcode: '4006381333931' });
    // Searching the product list with a scanned code finds it too.
    const search = await request(context.app).get('/api/products').set(auth(employeeToken)).query({ search: '4006381333931' });
    expect(search.body.data.map((product: { id: number }) => product.id)).toEqual([milk]);

    expect((await request(context.app).put(`/api/products/${bread}/barcode`).set(auth()).send({ barcode: '4006381333931' })).status).toBe(409);
    expect((await request(context.app).put(`/api/products/${bread}/barcode`).set(auth()).send({ barcode: '4006381333932' })).status).toBe(400);
    expect((await request(context.app).put(`/api/products/${bread}/barcode`).set(auth(employeeToken)).send({ barcode: '12345678' })).status).toBe(403);
    expect((await request(context.app).get('/api/products/barcode/9999999999994').set(auth())).status).toBe(404);
  });

  it('should create a shop barcode for a product without one', async () => {
    const vase = await createTestProduct(context, adminToken, { name: 'Vase', price: 35, stock: 5 });

    const created = await request(context.app).post(`/api/products/${vase}/barcode`).set(auth());

    expect(created.status).toBe(201);
    expect(created.body.data.barcode).toBe(inStoreBarcode(vase));
    expect((await request(context.app).post(`/api/products/${vase}/barcode`).set(auth())).status).toBe(409);
  });
});

describe('basket checkout', () => {
  it('should record several products at once, each as its own sale', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 1.2, stock: 10 });
    const bread = await createTestProduct(context, adminToken, { name: 'Bread', price: 1, stock: 10 });

    const response = await request(context.app)
      .post('/api/sales/basket')
      .set(auth(employeeToken))
      .send({ items: [{ productId: milk, quantity: 3 }, { productId: bread, quantity: 2 }] });

    expect(response.status).toBe(201);
    expect(response.body.data.total).toBe(5.6);
    expect(response.body.data.sales.map((sale: { productName: string }) => sale.productName)).toEqual(['Milk', 'Bread']);
  });

  it('should save nothing when one product runs short', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 1.2, stock: 10 });
    const bread = await createTestProduct(context, adminToken, { name: 'Bread', price: 1, stock: 1 });

    const response = await request(context.app)
      .post('/api/sales/basket')
      .set(auth(employeeToken))
      .send({ items: [{ productId: milk, quantity: 3 }, { productId: bread, quantity: 2 }] });

    expect(response.status).toBe(400);
    expect(await context.db.selectFrom('sales').select('id').execute()).toHaveLength(0);
  });

  it('should put the whole basket on a tab, and refuse the same product twice', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 1.2, stock: 10 });
    const bread = await createTestProduct(context, adminToken, { name: 'Bread', price: 1, stock: 10 });
    const customer = (await request(context.app).post('/api/customers').set(auth(employeeToken)).send({ name: 'Arben' })).body.data.id;

    await request(context.app)
      .post('/api/sales/basket')
      .set(auth(employeeToken))
      .send({ customerId: customer, items: [{ productId: milk, quantity: 1 }, { productId: bread, quantity: 1 }] });
    expect((await request(context.app).get(`/api/customers/${customer}`).set(auth())).body.data.balance).toBe(2.2);

    const twice = await request(context.app)
      .post('/api/sales/basket')
      .set(auth(employeeToken))
      .send({ items: [{ productId: milk, quantity: 1 }, { productId: milk, quantity: 1 }] });
    expect(twice.status).toBe(400);
  });
});

describe('carwash from the team app', () => {
  it("should let staff enter today's takings, but not other days", async () => {
    expect((await request(context.app).get('/api/carwash/today').set(auth(employeeToken))).body.data).toEqual({
      day: today(),
      carwashes: [{ id: 1, name: 'Carwash', cashFloat: 0, archived: false, takings: null }],
    });
    expect((await request(context.app).put(`/api/carwash/${today()}`).set(auth(employeeToken)).send({ carwash: 50, change: 10 })).status).toBe(200);
    expect((await request(context.app).get('/api/carwash/today').set(auth(employeeToken))).body.data.carwashes[0].takings).toEqual({ carwash: 50, change: 10 });
    expect((await request(context.app).put('/api/carwash/2026-09-01').set(auth(employeeToken)).send({ carwash: 50, change: 10 })).status).toBe(403);
    expect((await request(context.app).delete(`/api/carwash/${today()}`).set(auth(employeeToken))).status).toBe(403);
  });
});

describe('sales history by checkout', () => {
  it('should list each checkout once, with its lines, newest first', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 1.2, stock: 10 });
    const bread = await createTestProduct(context, adminToken, { name: 'Bread', price: 1, stock: 10 });
    await request(context.app).post('/api/sales/basket').set(auth(employeeToken)).send({ items: [{ productId: milk, quantity: 1 }] });
    await request(context.app)
      .post('/api/sales/basket')
      .set(auth(employeeToken))
      .send({ items: [{ productId: milk, quantity: 3 }, { productId: bread, quantity: 2 }] });

    const response = await request(context.app).get('/api/sales/checkouts').set(auth());

    expect(response.status).toBe(200);
    const { checkouts, totalRevenue } = response.body.data;
    expect(checkouts).toHaveLength(2);
    expect(checkouts[0].lines.map((line: { productName: string }) => line.productName)).toEqual(['Milk', 'Bread']);
    expect(checkouts[0]).toMatchObject({ total: 5.6, invoice: { number: expect.any(String) } });
    expect(checkouts[1].lines).toHaveLength(1);
    expect(totalRevenue).toBe(6.8);
    expect(response.body.meta.total).toBe(2);

    // A product filter keeps the checkouts that have it, showing only those lines.
    const breadOnly = (await request(context.app).get('/api/sales/checkouts').query({ productId: bread }).set(auth())).body.data;
    expect(breadOnly.checkouts).toHaveLength(1);
    expect(breadOnly.checkouts[0].lines).toHaveLength(1);
    expect((await request(context.app).get('/api/sales/checkouts').set(auth(employeeToken))).status).toBe(403);
  });

  it("should show staff only their own checkouts, with how much of each line was returned", async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 1.2, stock: 10 });
    const bread = await createTestProduct(context, adminToken, { name: 'Bread', price: 1, stock: 10 });
    await request(context.app).post('/api/sales/basket').set(auth()).send({ items: [{ productId: bread, quantity: 1 }] });
    const mine = await request(context.app)
      .post('/api/sales/basket')
      .set(auth(employeeToken))
      .send({ items: [{ productId: milk, quantity: 3 }, { productId: bread, quantity: 2 }] });
    const milkLine = mine.body.data.sales[0].id;
    await request(context.app).post(`/api/sales/${milkLine}/returns`).set(auth(employeeToken)).send({ quantity: 1, condition: 'resellable' });

    // Asking for someone else's sales still gives your own.
    const adminId = (await request(context.app).get('/api/auth/me').set(auth())).body.data.id;
    const response = await request(context.app).get('/api/sales/checkouts/mine').query({ soldBy: adminId }).set(auth(employeeToken));

    expect(response.status).toBe(200);
    const { checkouts } = response.body.data;
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0]).toMatchObject({ total: 5.6, invoice: { number: expect.any(String) } });
    expect(checkouts[0].lines.find((line: { productName: string }) => line.productName === 'Milk')).toMatchObject({ quantity: 3, returnedQuantity: 1 });
  });

  it('should leave an undone sale out of the history and its totals', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 1.2, stock: 10 });
    await request(context.app).post('/api/sales/basket').set(auth()).send({ items: [{ productId: milk, quantity: 1 }] });
    const sale = (await request(context.app).post('/api/sales').set(auth()).send({ productId: milk, quantity: 2, notes: null })).body.data;
    const entry = await context.db
      .selectFrom('activity_log')
      .select('id')
      .where('entity_type', '=', 'sale')
      .where('entity_id', '=', sale.id)
      .executeTakeFirstOrThrow();
    expect((await request(context.app).post(`/api/activity/${entry.id}/undo`).set(auth()).send({})).status).toBe(200);

    const checkouts = (await request(context.app).get('/api/sales/checkouts').set(auth())).body.data;
    expect(checkouts.checkouts).toHaveLength(1);
    expect(checkouts.totalRevenue).toBe(1.2);
    const list = (await request(context.app).get('/api/sales').set(auth())).body;
    expect(list.data.sales.map((line: { id: number }) => line.id)).not.toContain(sale.id);
    expect(list.data.totalRevenue).toBe(1.2);
  });

  it('should find checkouts by product or invoice number, and total each day shown', async () => {
    const milk = await createTestProduct(context, adminToken, { name: 'Milk', price: 1.2, stock: 10 });
    const bread = await createTestProduct(context, adminToken, { name: 'Bread', price: 1, stock: 10 });
    await request(context.app).post('/api/sales/basket').set(auth(employeeToken)).send({ items: [{ productId: milk, quantity: 1 }] });
    await request(context.app).post('/api/sales/basket').set(auth(employeeToken)).send({ items: [{ productId: bread, quantity: 2 }] });
    const checkouts = (search?: string) =>
      request(context.app).get('/api/sales/checkouts').query(search ? { search } : {}).set(auth());

    const all = (await checkouts()).body.data;
    expect(all.checkouts[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(all.days).toEqual([{ day: all.checkouts[0].day, checkouts: 2, revenue: 3.2 }]);

    const bySearch = (await checkouts('brea')).body.data;
    expect(bySearch.checkouts).toHaveLength(1);
    expect(bySearch.checkouts[0].lines[0].productName).toBe('Bread');

    const invoice = all.checkouts[1].invoice.number as string;
    const byInvoice = (await checkouts(invoice)).body.data;
    expect(byInvoice.checkouts.map((row: { key: string }) => row.key)).toEqual([all.checkouts[1].key]);
    expect((await checkouts('100%_')).body.data.checkouts).toEqual([]);
  });
});
