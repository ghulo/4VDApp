import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAsBusiness } from '../src/database/businessContext.js';
import { asShop, createTestProduct, loginAs, resetData, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers/testApp.js';

/**
 * Two businesses on one database: whatever the second one asks for over the
 * API, it never sees or changes the first one's rows. Row security in the
 * database backs this up even where a query forgets to filter.
 */
const MARKER = 'Marker-of-shop-A-7f3c';

let context: TestContext;
let shopToken: string;
let otherToken: string;
let otherId: number;
let productId: number;
let otherCategoryId: number;

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  context = await setupTestApp();
  await resetData(context.db);
  shopToken = await loginAs(context, 'admin');
  productId = await createTestProduct(context, shopToken, { name: MARKER, barcode: '3830000000017' });
  await asShop(() => sql`INSERT INTO notifications (user_id, title, message, type) SELECT id, ${MARKER}, ${MARKER}, 'info' FROM users`.execute(context.db));

  // A second business with its own admin, set up the way a new business starts.
  otherId = (await context.db.insertInto('businesses').values({ name: 'Other shop' }).returning('id').executeTakeFirstOrThrow()).id;
  const passwordHash = (await context.db.selectFrom('users').select('password_hash').executeTakeFirstOrThrow()).password_hash;
  await runAsBusiness(otherId, async () => {
    otherCategoryId = (await context.db.insertInto('categories').values({ name: 'Other' }).returning('id').executeTakeFirstOrThrow()).id;
    await sql`INSERT INTO stock_locations (name, sells_here, receives_here) VALUES ('Shop floor', true, true)`.execute(context.db);
    await context.db
      .insertInto('users')
      .values({ email: 'admin@other.local', name: 'Other admin', role: 'admin', is_active: true, password_hash: passwordHash, business_id: otherId, email_verified_at: new Date() })
      .execute();
  });
  const login = await request(context.app).post('/api/auth/login').send({ email: 'admin@other.local', password: TEST_PASSWORD });
  expect(login.status).toBe(200);
  otherToken = login.body.data.token as string;
});
afterAll(() => context.db.destroy());

describe('a second business never sees the first one’s data', () => {
  it('does not list, find or open the first business’s product', async () => {
    const list = await request(context.app).get('/api/products').set(as(otherToken));
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(MARKER);
    const search = await request(context.app).get('/api/products').query({ search: MARKER }).set(as(otherToken));
    expect(JSON.stringify(search.body)).not.toContain(MARKER);
    expect((await request(context.app).get(`/api/products/${productId}`).set(as(otherToken))).status).toBe(404);
    expect((await request(context.app).get('/api/products/barcode/3830000000017').set(as(otherToken))).status).toBe(404);
    expect((await request(context.app).get('/api/products/code/3830000000017').set(as(otherToken))).status).toBe(404);
    await context.db.updateTable('products').set({ sku: 'ISO-SKU-1' }).where('id', '=', productId).execute();
    expect((await request(context.app).get('/api/products/code/ISO-SKU-1').set(as(otherToken))).status).toBe(404);
    // A till event can't name another business's product.
    const event = { kind: 'line_removed', productId, quantity: 1, amount: 1, reason: 'Scanned twice' };
    expect((await request(context.app).post('/api/counter/events').set(as(otherToken)).send({ events: [event] })).status).toBe(400);
    expect((await request(context.app).post('/api/counter/events').set(as(shopToken)).send({ events: [event] })).status).toBe(201);
    // The first business still sees it.
    expect(JSON.stringify((await request(context.app).get('/api/products').set(as(shopToken))).body)).toContain(MARKER);
  });

  it('cannot change or delete the first business’s product', async () => {
    const update = await request(context.app).put(`/api/products/${productId}`).set(as(otherToken)).send({ name: 'Taken over', price: 1, costPrice: 1, reorderLevel: 0, categoryId: otherCategoryId });
    expect([403, 404]).toContain(update.status);
    const remove = await request(context.app).delete(`/api/products/${productId}`).set(as(otherToken));
    expect([403, 404]).toContain(remove.status);
    const row = await asShop(() => context.db.selectFrom('products').select(['name', 'is_active']).where('id', '=', productId).executeTakeFirstOrThrow());
    expect(row).toEqual({ name: MARKER, is_active: true });
  });

  it('keeps notifications and people apart', async () => {
    const notes = await request(context.app).get('/api/notifications').set(as(otherToken));
    expect(notes.status).toBe(200);
    expect(JSON.stringify(notes.body)).not.toContain(MARKER);
    expect(JSON.stringify((await request(context.app).get('/api/notifications').set(as(shopToken))).body)).toContain(MARKER);
    const people = await request(context.app).get('/api/users').set(as(otherToken));
    expect(JSON.stringify(people.body)).not.toContain('admin@test.local');
  });

  it('is held back by the database itself, not only by the queries', async () => {
    // A query that forgets to filter by business still sees only its own rows.
    const seen = await runAsBusiness(otherId, () => context.db.selectFrom('products').select('name').execute());
    expect(seen).toEqual([]);
    await expect(
      runAsBusiness(otherId, () => context.db.updateTable('products').set({ name: 'Taken over' }).where('id', '=', productId).execute()),
    ).resolves.toEqual([expect.objectContaining({ numUpdatedRows: 0n })]);
  });
});
