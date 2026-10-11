import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestCategory, createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
const tokens = {} as Record<'owner' | 'admin' | 'employee', string>;
let categoryId: number;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  for (const role of ['owner', 'admin', 'employee'] as const) tokens[role] = await loginAs(context, role);
  categoryId = (await createTestCategory(context.db, 'Drinks')).id;
});
afterAll(() => context.db.destroy());

const api = () => request(context.app);
const auth = (role: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[role]}` });
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const water = { name: 'Bravo water 1L', categoryId: null, price: 0.6, barcode: '5301234567891', stock: 24, photo: { mime: 'image/png', data: PNG } };

async function ask(body: Record<string, unknown> = water) {
  const response = await api().post('/api/product-requests').set(auth('employee')).send(body);
  expect(response.status).toBe(201);
  return response.body.data as { kind: 'request'; request: { id: number; status: string; originCountry: string | null } };
}

const productNamed = (name: string) => context.db.selectFrom('products').selectAll().where('name', '=', name).executeTakeFirst();

describe('product requests', () => {
  it("should keep an employee's new product out of the shop until someone approves it", async () => {
    const { kind, request: asked } = await ask();
    expect(kind).toBe('request');
    expect(asked).toMatchObject({ status: 'pending', originCountry: 'AL' });
    expect(await productNamed('Bravo water 1L')).toBeUndefined();

    const alerts = await context.db
      .selectFrom('notifications')
      .select('id')
      .where('subject_type', '=', 'product_request')
      .where('subject_id', '=', asked.id)
      .execute();
    expect(alerts.length).toBeGreaterThan(0);
    const summary = (await api().get('/api/approvals/summary').set(auth('owner'))).body.data;
    expect(summary.productRequests).toBe(1);
    const mine = (await api().get('/api/approvals/mine').set(auth('employee'))).body.data;
    expect(mine[0]).toMatchObject({ type: 'product', status: 'pending' });
  });

  it('should create the product with the corrections when the owner approves, once', async () => {
    const { request: asked } = await ask();
    // No category yet: the decider has to choose one.
    await api().post(`/api/product-requests/${asked.id}/approve`).set(auth('owner')).send({}).expect(400);
    const approved = await api().post(`/api/product-requests/${asked.id}/approve`).set(auth('owner')).send({ categoryId, price: 0.7 });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('approved');

    const product = (await productNamed('Bravo water 1L'))!;
    expect(Number(product.base_price)).toBe(0.7);
    expect(product.barcode).toBe('5301234567891');
    expect(product.origin_country).toBe('AL');
    expect(product.image_url).toMatch(/^\/api\/media\//);
    const stock = await context.db.selectFrom('inventory').select('quantity_on_hand').where('product_id', '=', product.id).executeTakeFirstOrThrow();
    expect(stock.quantity_on_hand).toBe(24);

    await api().post(`/api/product-requests/${asked.id}/approve`).set(auth('admin')).send({ categoryId }).expect(409);
    const told = await context.db
      .selectFrom('notifications as n')
      .innerJoin('users as u', 'u.id', 'n.user_id')
      .select('n.title')
      .where('u.role', '=', 'employee')
      .execute();
    expect(told.some((row) => row.title.includes('Bravo water 1L'))).toBe(true);
  });

  it('should put the request back when the barcode was taken by then', async () => {
    const { request: asked } = await ask({ ...water, barcode: null });
    const id = await createTestProduct(context, tokens.admin, { name: 'Other water' });
    await api().put(`/api/products/${id}/barcode`).set(auth('admin')).send({ barcode: '5301234567891' }).expect(200);
    await api().post(`/api/product-requests/${asked.id}/approve`).set(auth('owner')).send({ categoryId, barcode: '5301234567891' }).expect(409);
    expect((await api().get(`/api/product-requests/${asked.id}`).set(auth('owner'))).body.data.status).toBe('pending');
  });

  it('should tell the employee why when it is rejected', async () => {
    const { request: asked } = await ask();
    const rejected = await api().post(`/api/product-requests/${asked.id}/reject`).set(auth('owner')).send({ note: 'We already sell it' });
    expect(rejected.body.data).toMatchObject({ status: 'rejected', decisionNote: 'We already sell it' });
    expect(await productNamed('Bravo water 1L')).toBeUndefined();
  });

  it('should add the product at once when the owner adds it', async () => {
    const response = await api().post('/api/product-requests').set(auth('owner')).send({ ...water, categoryId });
    expect(response.body.data.kind).toBe('product');
    expect(await productNamed('Bravo water 1L')).toBeDefined();
  });

  it('should let the owner edit products but not delete them, and keep employees out', async () => {
    const id = await createTestProduct(context, tokens.admin);
    const product = await context.db.selectFrom('products').select('category_id').where('id', '=', id).executeTakeFirstOrThrow();
    const body = { name: 'Oak Chair', categoryId: product.category_id, price: 120 };
    await api().put(`/api/products/${id}`).set(auth('owner')).send(body).expect(200);
    await api().put(`/api/products/${id}`).set(auth('employee')).send(body).expect(403);
    await api().delete(`/api/products/${id}`).set(auth('owner')).expect(403);
  });
});
