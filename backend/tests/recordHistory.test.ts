import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fieldChangesOf } from '../src/services/activity/fieldChanges.js';
import { countryFromBarcode } from '../src/utils/barcodeCountry.js';
import { createTestProduct, createTestUser, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

describe('countryFromBarcode', () => {
  it('should read the country from the prefix', () => {
    expect(countryFromBarcode('5301234567890')).toBe('AL');
    expect(countryFromBarcode('8600000000000')).toBe('RS');
    expect(countryFromBarcode('8690000000000')).toBe('TR');
    expect(countryFromBarcode('4006381333931')).toBe('DE');
    // A 12-digit UPC-A is American.
    expect(countryFromBarcode('012345678905')).toBe('US');
  });

  it('should give none for shop-made codes, books and other codes', () => {
    expect(countryFromBarcode('2000000000013')).toBeNull();
    expect(countryFromBarcode('9780306406157')).toBeNull();
    expect(countryFromBarcode('ABC-123')).toBeNull();
    expect(countryFromBarcode('96385074')).toBeNull();
    expect(countryFromBarcode(null)).toBeNull();
  });
});

describe('fieldChangesOf', () => {
  it('should read every way a change is logged', () => {
    expect(fieldChangesOf({ action: 'product.updated', details: { price: { from: 1, to: 2 }, undoOf: 4 } })).toEqual([{ field: 'price', from: 1, to: 2 }]);
    expect(fieldChangesOf({ action: 'business.updated', details: { fields: [{ field: 'name', from: 'A', to: 'B' }] } })).toEqual([
      { field: 'name', from: 'A', to: 'B' },
    ]);
    expect(
      fieldChangesOf({ action: 'supplier.updated', details: { before: { id: 1, name: 'A', phone: '1' }, after: { name: 'B', phone: '1' } } }),
    ).toEqual([{ field: 'name', from: 'A', to: 'B' }]);
    expect(fieldChangesOf({ action: 'product.barcode_set', details: { from: null, to: '123' } })).toEqual([{ field: 'barcode', from: null, to: '123' }]);
    expect(fieldChangesOf({ action: 'product.created', details: { price: 5 } })).toEqual([]);
  });
});

describe('restoring a record to an earlier point', () => {
  let context: TestContext;
  const tokens = {} as Record<'developer' | 'admin', string>;
  const api = () => request(context.app);
  const auth = (role: 'developer' | 'admin') => ({ Authorization: `Bearer ${tokens[role]}` });

  beforeAll(async () => {
    context = await setupTestApp();
  });
  beforeEach(async () => {
    await resetData(context.db);
    tokens.developer = await loginAs(context, 'developer');
    tokens.admin = await loginAs(context, 'admin');
  });
  afterAll(() => context.db.destroy());

  const latestEntry = async () => (await context.db.selectFrom('activity_log').select('id').orderBy('id', 'desc').executeTakeFirstOrThrow()).id;
  const product = async (id: number) => (await api().get(`/api/products/${id}`).set(auth('admin'))).body.data;

  async function setPrice(id: number, price: number) {
    const current = await product(id);
    const response = await api()
      .put(`/api/products/${id}`)
      .set(auth('admin'))
      .send({ name: current.name, categoryId: current.category.id, price, costPrice: current.costPrice, isActive: true });
    expect(response.status).toBe(200);
    return latestEntry();
  }

  it("should fill the country from a new barcode and keep the change in the product's history", async () => {
    const id = await createTestProduct(context, tokens.admin);
    await api().put(`/api/products/${id}/barcode`).set(auth('admin')).send({ barcode: '5301234567891' }).expect(200);

    expect((await product(id)).originCountry).toBe('AL');
    const history = (await api().get('/api/activity/history').query({ entityType: 'product', entityId: id }).set(auth('admin'))).body.data;
    expect(history.at(-1).changes).toEqual([
      { field: 'barcode', from: null, to: '5301234567891' },
      { field: 'originCountry', from: null, to: 'AL' },
    ]);
  });

  it('should put every field changed since back, only for the developer, and refuse when it changed meanwhile', async () => {
    const id = await createTestProduct(context, tokens.admin, { price: 89 });
    const point = await setPrice(id, 79);
    await api().put(`/api/products/${id}/barcode`).set(auth('admin')).send({ barcode: '5301234567891' }).expect(200);
    await setPrice(id, 99);

    await api().get(`/api/activity/${point}/restore-point`).set(auth('admin')).expect(403);
    const plan = (await api().get(`/api/activity/${point}/restore-point`).set(auth('developer')).expect(200)).body.data;
    expect(plan.changes).toEqual(
      expect.arrayContaining([
        { field: 'price', from: 99, to: 79 },
        { field: 'barcode', from: '5301234567891', to: null },
      ]),
    );

    await setPrice(id, 109);
    await api().post(`/api/activity/${point}/restore-point`).set(auth('developer')).send({ latestEntryId: plan.latestEntryId }).expect(409);

    const fresh = (await api().get(`/api/activity/${point}/restore-point`).set(auth('developer'))).body.data;
    await api().post(`/api/activity/${point}/restore-point`).set(auth('developer')).send({ latestEntryId: fresh.latestEntryId }).expect(200);
    const restored = await product(id);
    expect(restored.price).toBe(79);
    expect(restored.barcode).toBeNull();

    const marked = await context.db.selectFrom('activity_log').select('details').where('id', '>', fresh.latestEntryId).execute();
    expect(marked.length).toBeGreaterThan(0);
    for (const row of marked) expect(row.details).toMatchObject({ restoredTo: point });
    // Nothing left to put back.
    const after = (await api().get(`/api/activity/${point}/restore-point`).set(auth('developer'))).body.data;
    expect(after.changes).toEqual([]);
  });

  it("should put a person's role back", async () => {
    const employee = await createTestUser(context.db, 'employee');
    await api().put(`/api/users/${employee.id}`).set(auth('admin')).send({ name: 'Arta' }).expect(200);
    const point = await latestEntry();
    await api().put(`/api/users/${employee.id}`).set(auth('developer')).send({ role: 'admin' }).expect(200);

    const plan = (await api().get(`/api/activity/${point}/restore-point`).set(auth('developer'))).body.data;
    expect(plan.changes).toEqual([{ field: 'role', from: 'admin', to: 'employee' }]);
    await api().post(`/api/activity/${point}/restore-point`).set(auth('developer')).send({ latestEntryId: plan.latestEntryId }).expect(200);
    const row = await context.db.selectFrom('users').select('role').where('id', '=', employee.id).executeTakeFirstOrThrow();
    expect(row.role).toBe('employee');
  });
});
