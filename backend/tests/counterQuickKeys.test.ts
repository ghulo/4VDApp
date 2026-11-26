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

const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const shelfKeys = async () => {
  const shelf = await request(context.app).get('/api/counter/shelf').set(auth(employeeToken));
  return (shelf.body.data as Array<{ id: number; quickKey: number | null }>)
    .filter((product) => product.quickKey !== null)
    .sort((a, b) => a.quickKey! - b.quickKey!)
    .map((product) => product.id);
};

describe('Counter quick keys', () => {
  it('should keep the order the owner picks, on the till shelf, and replace it on the next save', async () => {
    const bread = await createTestProduct(context, adminToken, { name: 'Bread', price: 0.5, stock: 20 });
    const apples = await createTestProduct(context, adminToken, { name: 'Apples', price: 1.2, stock: 20 });
    const eggs = await createTestProduct(context, adminToken, { name: 'Eggs', price: 2, stock: 20 });

    expect((await request(context.app).put('/api/counter/quick-keys').set(auth()).send({ productIds: [apples, bread] })).status).toBe(200);
    expect(await shelfKeys()).toEqual([apples, bread]);

    // A new list replaces the old one: bread loses its key, eggs come first.
    expect((await request(context.app).put('/api/counter/quick-keys').set(auth()).send({ productIds: [eggs, apples] })).status).toBe(200);
    expect(await shelfKeys()).toEqual([eggs, apples]);

    const history = await context.db.selectFrom('activity_log').select(['action', 'details']).where('action', '=', 'counter.quick_keys_changed').orderBy('id', 'desc').executeTakeFirst();
    expect(history?.details).toMatchObject({ from: [apples, bread], to: [eggs, apples] });

    expect((await request(context.app).put('/api/counter/quick-keys').set(auth()).send({ productIds: [] })).status).toBe(200);
    expect(await shelfKeys()).toEqual([]);
  });

  it('should refuse a cashier, the same product twice, more than 24 and a product that is not on sale', async () => {
    const bread = await createTestProduct(context, adminToken, { name: 'Bread', price: 0.5, stock: 20 });

    expect((await request(context.app).put('/api/counter/quick-keys').set(auth(employeeToken)).send({ productIds: [bread] })).status).toBe(403);
    expect((await request(context.app).put('/api/counter/quick-keys').set(auth()).send({ productIds: [bread, bread] })).status).toBe(400);
    expect((await request(context.app).put('/api/counter/quick-keys').set(auth()).send({ productIds: Array.from({ length: 25 }, (_, i) => i + 1) })).status).toBe(400);
    expect((await request(context.app).put('/api/counter/quick-keys').set(auth()).send({ productIds: [999999] })).status).toBe(400);
    expect(await shelfKeys()).toEqual([]);
  });
});
