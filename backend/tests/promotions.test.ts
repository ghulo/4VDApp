import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestCategory, createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let employeeToken: string;
let categoryId: number;
let chairId: number;
let tableId: number;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
  employeeToken = await loginAs(context, 'employee');
  categoryId = (await createTestCategory(context.db, 'Furniture')).id;
  chairId = await createTestProduct(context, adminToken, { name: 'Oak Chair', price: 100, costPrice: 60, categoryId });
  tableId = await createTestProduct(context, adminToken, { name: 'Oak Table', price: 200, costPrice: 180, categoryId });
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const DAY = 24 * 60 * 60 * 1000;
/** A UTC day relative to today, like "2026-10-02". */
const day = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

const createPromotion = (body: Record<string, unknown>) =>
  request(context.app)
    .post('/api/promotions')
    .set(auth(adminToken))
    .send({ name: 'Autumn sale', startsAt: day(0), endsAt: day(6), ...body });

const sell = (productId: number, quantity = 1) =>
  request(context.app).post('/api/sales').set(auth(employeeToken)).send({ productId, quantity });

describe('promotions', () => {
  it('should lower the sale price and show the promotion on the product while it runs', async () => {
    const created = await createPromotion({ percentOff: 15, productId: chairId });

    const product = await request(context.app).get(`/api/products/${chairId}`).set(auth(employeeToken));
    const sale = await sell(chairId, 2);
    const stored = await context.db.selectFrom('sales').select('promotion_id').executeTakeFirstOrThrow();

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: 'running', percentOff: 15, product: { id: chairId } });
    expect(product.body.data.promotion).toMatchObject({ percentOff: 15, price: 85 });
    expect(sale.body.data).toMatchObject({ pricePerUnit: 85, totalAmount: 170 });
    expect(stored.promotion_id).toBe(created.body.data.id);
  });

  it('should not touch prices before it starts or after it is ended early', async () => {
    const later = await createPromotion({ percentOff: 15, productId: chairId, startsAt: day(2), endsAt: day(5) });
    const now = await createPromotion({ percentOff: 10, productId: chairId });
    const ended = await request(context.app).post(`/api/promotions/${now.body.data.id}/end`).set(auth(adminToken));
    const endedAgain = await request(context.app).post(`/api/promotions/${now.body.data.id}/end`).set(auth(adminToken));

    const sale = await sell(chairId);

    expect(later.body.data.status).toBe('scheduled');
    expect(ended.body.data.status).toBe('ended');
    expect(endedAgain.status).toBe(409);
    expect(sale.body.data.pricePerUnit).toBe(100);
  });

  it('should refuse a discount that breaks the minimum margin and name the products', async () => {
    // The table costs 180, so 15% off 200 (= 170) is below cost; the chair is fine.
    const response = await createPromotion({ percentOff: 15, categoryId });
    const saved = await context.db.selectFrom('promotions').selectAll().execute();

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Oak Table');
    expect(response.body.message).not.toContain('Oak Chair');
    expect(saved).toHaveLength(0);
  });

  it('should apply a category promotion to every product in it', async () => {
    await request(context.app).put('/api/settings').set(auth(adminToken)).send({ minimumMarginPercent: 5 });
    await createPromotion({ percentOff: 5, categoryId });

    const table = await sell(tableId);
    const chair = await sell(chairId);

    expect(table.body.data.pricePerUnit).toBe(190);
    expect(chair.body.data.pricePerUnit).toBe(95);
  });

  it('should need exactly one of product or category, and an admin', async () => {
    const both = await createPromotion({ percentOff: 10, productId: chairId, categoryId });
    const neither = await createPromotion({ percentOff: 10 });
    const asEmployee = await request(context.app)
      .post('/api/promotions')
      .set(auth(employeeToken))
      .send({ name: 'x', percentOff: 10, productId: chairId, startsAt: day(0), endsAt: day(1) });

    expect(both.status).toBe(400);
    expect(neither.status).toBe(400);
    expect(asEmployee.status).toBe(403);
  });
});

describe('price history', () => {
  it('should list the starting price and every later price or cost change, newest first', async () => {
    await request(context.app)
      .put(`/api/products/${chairId}`)
      .set(auth(adminToken))
      .send({ name: 'Oak Chair', categoryId, price: 110, costPrice: 65, isActive: true });

    const response = await request(context.app).get(`/api/products/${chairId}/price-history`).set(auth(adminToken));
    const asEmployee = await request(context.app).get(`/api/products/${chairId}/price-history`).set(auth(employeeToken));

    expect(response.body.data).toMatchObject([
      { price: { from: 100, to: 110 }, costPrice: { from: 60, to: 65 }, changedBy: 'Test admin' },
      { price: { from: null, to: 100 }, costPrice: { from: null, to: 60 } },
    ]);
    expect(asEmployee.status).toBe(403);
  });
});
