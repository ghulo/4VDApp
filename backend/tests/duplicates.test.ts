import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestProduct, loginAs, resetData, setupTestApp, stockOf, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let token: string;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  token = await loginAs(context, 'admin');
});
afterAll(() => context.db.destroy());

const auth = () => ({ Authorization: `Bearer ${token}` });

async function flag(productId: number, otherId: number): Promise<number> {
  const [low, high] = productId < otherId ? [productId, otherId] : [otherId, productId];
  const row = await context.db
    .insertInto('product_duplicate_flags')
    .values({ product_id: low, other_product_id: high, reason: 'identical name', similarity: 1 })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function sell(productId: number, quantity: number) {
  const response = await request(context.app).post('/api/sales').set(auth()).send({ productId, quantity });
  expect(response.status).toBe(201);
}

/** Two Red Bulls: the one that sells, and a second one with its own barcode and stock. */
async function redBulls() {
  const kept = await createTestProduct(context, token, { name: 'Red Bull 250ml', price: 1.3, costPrice: 1, stock: 5 });
  const other = await createTestProduct(context, token, { name: 'Red Bull 250ml', price: 1.3, costPrice: 1, stock: 7 });
  await context.db.updateTable('products').set({ barcode: '9002490100070' }).where('id', '=', kept).execute();
  await context.db.updateTable('products').set({ barcode: '90162602' }).where('id', '=', other).execute();
  await sell(kept, 3);
  await sell(other, 1);
  return { kept, other, id: await flag(kept, other) };
}

describe('duplicate products', () => {
  it('should list open pairs with what helps decide, the busier seller first', async () => {
    const { kept, other } = await redBulls();
    await sell(other, 1);
    await sell(other, 2);

    const response = await request(context.app).get('/api/duplicates').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    const [first, second] = response.body.data[0].products;
    expect(first).toMatchObject({ id: other, unitsSold90d: 4, stock: 3, barcode: '90162602' });
    expect(second).toMatchObject({ id: kept, unitsSold90d: 3, stock: 2 });
  });

  it('should merge: sales, stock and barcodes move over and the other product goes', async () => {
    const { kept, other, id } = await redBulls();

    const response = await request(context.app).post(`/api/duplicates/${id}/merge`).set(auth()).send({ keepId: kept });

    expect(response.status).toBe(200);
    expect(await stockOf(context, kept)).toBe(2 + 6);
    expect(await stockOf(context, other)).toBe(0);
    const sales = await context.db.selectFrom('sales').select('product_id').execute();
    expect(sales.every((sale) => sale.product_id === kept)).toBe(true);
    const products = await context.db.selectFrom('products').select(['id', 'barcode', 'deleted_at']).orderBy('id').execute();
    // The kept product keeps its own barcode; the other's still finds it when scanned.
    expect(products[0]).toMatchObject({ id: kept, barcode: '9002490100070', deleted_at: null });
    expect(products[1]).toMatchObject({ barcode: null });
    expect(products[1]!.deleted_at).not.toBeNull();
    const scanned = await request(context.app).get('/api/products/barcode/90162602').set(auth());
    expect(scanned.body.data).toMatchObject({ id: kept, otherBarcodes: ['90162602'] });
    const adjustment = await context.db.selectFrom('stock_adjustments').selectAll().where('reason', '=', 'Merged duplicate').executeTakeFirstOrThrow();
    expect(adjustment).toMatchObject({ product_id: kept, adjustment_quantity: 6 });
    const log = await context.db.selectFrom('activity_log').select(['action', 'entity_id']).where('action', '=', 'product.merged').executeTakeFirstOrThrow();
    expect(log.entity_id).toBe(kept);

    const done = await request(context.app).get('/api/duplicates?status=done').set(auth());
    expect(done.body.data[0]).toMatchObject({ id, resolution: 'merged', resolvedBy: expect.any(String) });
    const again = await request(context.app).post(`/api/duplicates/${id}/merge`).set(auth()).send({ keepId: kept });
    expect(again.status).toBe(409);
  });

  it('should point other pairs of the merged-away product at the kept one', async () => {
    const { kept, other, id } = await redBulls();
    const third = await createTestProduct(context, token, { name: 'Red Bull 0.25L' });
    const otherPair = await flag(other, third);
    const samePair = await flag(kept, third);

    await request(context.app).post(`/api/duplicates/${id}/merge`).set(auth()).send({ keepId: kept });

    const open = await context.db.selectFrom('product_duplicate_flags').select(['id', 'product_id', 'other_product_id']).where('resolved_at', 'is', null).execute();
    // The other product's pair with the third would repeat the kept one's, so it goes.
    expect(open).toEqual([{ id: samePair, product_id: kept, other_product_id: third }]);
    expect(open.some((row) => row.id === otherPair)).toBe(false);
  });

  it('should keep both apart without touching either product', async () => {
    const { kept, other, id } = await redBulls();

    const response = await request(context.app).post(`/api/duplicates/${id}/keep-both`).set(auth());

    expect(response.status).toBe(200);
    expect(await stockOf(context, kept)).toBe(2);
    expect(await stockOf(context, other)).toBe(6);
    const open = await request(context.app).get('/api/duplicates').set(auth());
    expect(open.body.data).toHaveLength(0);
  });

  it('should refuse a product that is not in the pair, and staff', async () => {
    const { kept, id } = await redBulls();
    const stranger = await createTestProduct(context, token, { name: 'Coca Cola' });

    const wrong = await request(context.app).post(`/api/duplicates/${id}/merge`).set(auth()).send({ keepId: stranger });
    const employee = await loginAs(context, 'employee');
    const staff = await request(context.app).get('/api/duplicates').set({ Authorization: `Bearer ${employee}` });

    expect(wrong.status).toBe(400);
    expect(staff.status).toBe(403);
  });

  it('should ask for a review in To do while pairs are open, and clear itself after', async () => {
    const { id } = await redBulls();
    const todo = async () => (await request(context.app).get('/api/attention').set(auth())).body.data.todo as Array<{ key: string; title: string; to: string }>;

    expect((await todo()).find((item) => item.key === 'duplicates')).toMatchObject({ title: '1 product may be listed twice', to: '/inventory/duplicates' });

    await request(context.app).post(`/api/duplicates/${id}/keep-both`).set(auth());
    expect((await todo()).some((item) => item.key === 'duplicates')).toBe(false);
  });
});
