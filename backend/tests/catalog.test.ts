import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestCategory, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let browserToken: string;
let categoryId: number;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
  // Catalog reads need a login; family is the least-privileged role that can browse.
  browserToken = await loginAs(context, 'family', { email: 'browser@test.local' });
  categoryId = (await createTestCategory(context.db)).id;
});
afterAll(() => context.db.destroy());

const asAdmin = () => ({ Authorization: `Bearer ${adminToken}` });
const asBrowser = () => ({ Authorization: `Bearer ${browserToken}` });

function createProduct(overrides: Record<string, unknown> = {}) {
  return request(context.app)
    .post('/api/products')
    .set(asAdmin())
    .send({
      name: 'Oak Chair',
      categoryId,
      price: 100,
      costPrice: 40,
      sku: 'CHAIR-1',
      stock: 25,
      reorderLevel: 10,
      bulkPricingTiers: [
        { quantity: 50, price: 80 },
        { quantity: 10, price: 90 },
      ],
      ...overrides,
    });
}

describe('products', () => {
  it('should create a product with its stock and sorted bulk pricing', async () => {
    const response = await createProduct();

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      name: 'Oak Chair',
      price: 100,
      costPrice: 40,
      category: { id: categoryId, name: 'Furniture' },
      stock: { quantity: 25, reorderLevel: 10, isInStock: true, isLowStock: false },
      bulkPricingTiers: [
        { quantity: 10, price: 90 },
        { quantity: 50, price: 80 },
      ],
    });
  });

  it('should record the starting stock in the audit trail', async () => {
    const { body } = await createProduct();

    const inventory = await request(context.app).get(`/api/inventory/${body.data.id}`).set(asBrowser());

    expect(inventory.body.data.recentAdjustments).toEqual([
      expect.objectContaining({ quantity: 25, reason: 'Initial stock', adjustedBy: 'Test admin' }),
    ]);
  });

  it('should hide the cost price from anyone who is not an admin', async () => {
    const { body } = await createProduct();
    const familyToken = await loginAs(context, 'family');

    const asFamily = await request(context.app)
      .get(`/api/products/${body.data.id}`)
      .set('Authorization', `Bearer ${familyToken}`);

    expect(asFamily.body.data).not.toHaveProperty('costPrice');
  });

  it('should not let employees create products', async () => {
    const employeeToken = await loginAs(context, 'employee');

    const response = await request(context.app)
      .post('/api/products')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ name: 'X', categoryId, price: 1 });

    expect(response.status).toBe(403);
  });

  it('should reject bulk pricing that gets more expensive', async () => {
    const response = await createProduct({ bulkPricingTiers: [{ quantity: 10, price: 120 }] });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/lower than the base price/);
  });

  it('should reject a duplicate SKU with a clear message', async () => {
    await createProduct();

    const response = await createProduct({ name: 'Another chair' });

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('CHAIR-1');
  });

  it('should reject a category that does not exist', async () => {
    const response = await createProduct({ categoryId: 9999 });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/category 9999/);
  });

  it('should refuse to change stock through a product update', async () => {
    const { body } = await createProduct();

    const response = await request(context.app)
      .put(`/api/products/${body.data.id}`)
      .set(asAdmin())
      .send({ name: 'Oak Chair', categoryId, price: 100, stock: 999 });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/inventory/);
  });

  it('should keep existing tiers valid when only the price changes', async () => {
    const { body } = await createProduct();

    const response = await request(context.app)
      .put(`/api/products/${body.data.id}`)
      .set(asAdmin())
      .send({ name: 'Oak Chair', categoryId, price: 85 });

    // The 10+ tier is 90, which would now cost more than buying one.
    expect(response.status).toBe(400);
  });

  it('should filter by search text, category and stock, with pagination info', async () => {
    const lighting = await createTestCategory(context.db, 'Lighting');
    await createProduct();
    await createProduct({ name: 'Brass Lamp', sku: 'LAMP-1', categoryId: lighting.id, stock: 0, bulkPricingTiers: [] });

    const bySearch = await request(context.app).get('/api/products?search=lamp').set(asBrowser());
    const byCategory = await request(context.app).get(`/api/products?categoryId=${lighting.id}`).set(asBrowser());
    const inStockOnly = await request(context.app).get('/api/products?inStock=true').set(asBrowser());

    expect(bySearch.body.data.map((p: { name: string }) => p.name)).toEqual(['Brass Lamp']);
    expect(byCategory.body.data).toHaveLength(1);
    expect(inStockOnly.body.data.map((p: { name: string }) => p.name)).toEqual(['Oak Chair']);
    expect(inStockOnly.body.meta).toEqual({ page: 1, limit: 20, total: 1 });
  });

  it('should treat % in a search as plain text', async () => {
    await createProduct({ name: '50% Off Chair' });
    await createProduct({ name: 'Plain Chair', sku: 'CHAIR-2' });

    const response = await request(context.app).get('/api/products?search=50%25').set(asBrowser());

    expect(response.body.data).toHaveLength(1);
  });

  it('should hide inactive products from non-admins but show them to admins', async () => {
    await createProduct({ isActive: false });

    const asBrowserList = await request(context.app).get('/api/products').set(asBrowser());
    const asAdminList = await request(context.app).get('/api/products').set(asAdmin());

    expect(asBrowserList.body.data).toHaveLength(0);
    expect(asAdminList.body.data).toHaveLength(1);
  });

  it('should soft delete a product', async () => {
    const { body } = await createProduct();

    const deleted = await request(context.app).delete(`/api/products/${body.data.id}`).set(asAdmin());
    const fetched = await request(context.app).get(`/api/products/${body.data.id}`).set(asAdmin());
    const row = await context.db.selectFrom('products').select('deleted_at').where('id', '=', body.data.id).executeTakeFirst();

    expect(deleted.status).toBe(200);
    expect(fetched.status).toBe(404);
    expect(row?.deleted_at).not.toBeNull();
  });
});

describe('inventory', () => {
  const adjust = (productId: number, body: Record<string, unknown>) =>
    request(context.app).patch(`/api/inventory/${productId}`).set(asAdmin()).send(body);

  it('should add and remove stock and log each change', async () => {
    const { body } = await createProduct();

    await adjust(body.data.id, { quantity: 10, reason: 'Restock' });
    const response = await adjust(body.data.id, { quantity: -5, reason: 'Manual adjustment', notes: 'Dropped in storage' });

    expect(response.status).toBe(200);
    expect(response.body.data.quantity).toBe(30);
    expect(response.body.data.recentAdjustments.map((a: { reason: string }) => a.reason)).toEqual([
      'Manual adjustment',
      'Restock',
      'Initial stock',
    ]);
  });

  it('should never let stock go below zero', async () => {
    const { body } = await createProduct({ stock: 3 });

    const response = await adjust(body.data.id, { quantity: -4, reason: 'Manual adjustment' });
    const inventory = await request(context.app).get(`/api/inventory/${body.data.id}`).set(asBrowser());

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Not enough stock/);
    expect(inventory.body.data.quantity).toBe(3);
  });

  it('should require a reason when changing stock', async () => {
    const { body } = await createProduct();

    const response = await adjust(body.data.id, { quantity: 5 });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/reason/);
  });

  it('should notify admins once when stock drops to the reorder level', async () => {
    const { body } = await createProduct({ stock: 15, reorderLevel: 10 });

    await adjust(body.data.id, { quantity: -6, reason: 'Manual adjustment' });
    await adjust(body.data.id, { quantity: -2, reason: 'Manual adjustment' });
    const notifications = await context.db.selectFrom('notifications').selectAll().execute();

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ type: 'low_stock', title: 'Low stock: Oak Chair' });
  });

  it('should list low-stock items with the emptiest first', async () => {
    await createProduct({ name: 'Plenty', sku: 'A', stock: 100 });
    await createProduct({ name: 'Almost out', sku: 'B', stock: 1 });
    await createProduct({ name: 'Running low', sku: 'C', stock: 8 });

    const response = await request(context.app).get('/api/inventory?lowStock=true').set(asBrowser());

    expect(response.body.data.map((item: { productName: string }) => item.productName)).toEqual([
      'Almost out',
      'Running low',
    ]);
  });
});

describe('pricing tiers', () => {
  it('should replace the tiers of a product', async () => {
    const { body } = await createProduct();

    const response = await request(context.app)
      .put(`/api/pricing/tiers/${body.data.id}`)
      .set(asAdmin())
      .send({ tiers: [{ quantity: 5, price: 95 }] });
    const fetched = await request(context.app).get(`/api/pricing/tiers/${body.data.id}`).set(asBrowser());

    expect(response.status).toBe(200);
    expect(fetched.body.data).toEqual({ productId: body.data.id, basePrice: 100, tiers: [{ quantity: 5, price: 95 }] });
  });
});

describe('categories', () => {
  it('should list categories with how many products they have', async () => {
    await createProduct();

    const response = await request(context.app).get('/api/categories').set(asBrowser());

    expect(response.body.data).toEqual([expect.objectContaining({ name: 'Furniture', productCount: 1 })]);
  });

  it('should reject a duplicate name regardless of letter case', async () => {
    const response = await request(context.app).post('/api/categories').set(asAdmin()).send({ name: 'FURNITURE' });

    expect(response.status).toBe(409);
  });

  it('should refuse to delete a category that still has products', async () => {
    await createProduct();

    const response = await request(context.app).delete(`/api/categories/${categoryId}`).set(asAdmin());

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/1 product/);
  });
});

describe('access', () => {
  const readEndpoints = ['/api/products', '/api/products/1', '/api/categories', '/api/inventory', '/api/inventory/1', '/api/pricing/tiers/1'];

  it.each(readEndpoints)('should require login for GET %s', async (path) => {
    const response = await request(context.app).get(path);

    expect(response.status).toBe(401);
  });

  it('should let any logged-in role browse the catalog', async () => {
    const familyToken = await loginAs(context, 'family');

    const response = await request(context.app).get('/api/products').set({ Authorization: `Bearer ${familyToken}` });

    expect(response.status).toBe(200);
  });
});
