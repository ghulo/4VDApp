import request from 'supertest';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { DuplicateRepository } from '../src/repositories/DuplicateRepository.js';
import { BooksPoster } from '../src/services/books/BooksPoster.js';
import { shopTimeZone } from '../src/validators/operationsValidators.js';
import { createTestProduct, loginAs, resetData, setupTestApp, stockOf, type TestContext } from './helpers/testApp.js';
import { up as addLocations, down as dropLocations } from '../src/database/migrations/069_stock_locations.js';

let context: TestContext;
let adminToken: string;
let ownerToken: string;
let employeeToken: string;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  await seedBooks(context.db as never);
  adminToken = await loginAs(context, 'admin');
  ownerToken = await loginAs(context, 'owner');
  employeeToken = await loginAs(context, 'employee');
});
afterAll(() => context.db.destroy());

const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);
const today = () => new Date().toISOString().slice(0, 10);

/** How much of a product each location holds, by location name. */
async function where(productId: number): Promise<Record<string, number>> {
  const rows = await context.db
    .selectFrom('location_stock as s')
    .innerJoin('stock_locations as l', 'l.id', 's.location_id')
    .select(['l.name', 's.quantity'])
    .where('s.product_id', '=', productId)
    .execute();
  return Object.fromEntries(rows.filter((row) => row.quantity !== 0).map((row) => [row.name, row.quantity]));
}

/** Every product's locations add up to its total. */
async function expectSumsMatch() {
  const off = await sql<{ product_id: number }>`
    SELECT i.product_id FROM inventory i
    LEFT JOIN (SELECT product_id, sum(quantity) AS q FROM location_stock GROUP BY product_id) s ON s.product_id = i.product_id
    WHERE round(i.quantity_on_hand::numeric, 3) <> round(coalesce(s.q, 0)::numeric, 3)
  `.execute(context.db);
  expect(off.rows).toEqual([]);
}

async function addDepo(name = 'Depo'): Promise<number> {
  const response = await api().post('/api/locations').set(auth(ownerToken)).send({ name });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data.id;
}

const floorId = 1;

const moveStock = (body: Record<string, unknown>, token = ownerToken) => api().post('/api/stock-moves').set(auth(token)).send({ day: today(), ...body });

describe('stock locations', () => {
  it('starts with one location, the shop floor, that sells and receives', async () => {
    const list = await api().get('/api/locations').set(auth(employeeToken));
    expect(list.body.data).toEqual([{ id: floorId, name: 'Shop floor', sellsHere: true, receivesHere: true, units: 0, products: 0 }]);
    const soap = await createTestProduct(context, adminToken, { name: 'Sapun', stock: 10 });
    expect(await where(soap)).toEqual({ 'Shop floor': 10 });
  });

  it('adds, renames and removes a location only when empty, never the last or the selling one', async () => {
    expect((await api().post('/api/locations').set(auth(employeeToken)).send({ name: 'Depo' })).status).toBe(403);
    const depo = await addDepo();
    expect((await api().post('/api/locations').set(auth(ownerToken)).send({ name: 'depo' })).status).toBe(409);
    const renamed = await api().patch(`/api/locations/${depo}`).set(auth(ownerToken)).send({ name: 'Depoja e vogël' });
    expect(renamed.body.data.name).toBe('Depoja e vogël');

    const soap = await createTestProduct(context, adminToken, { name: 'Sapun', stock: 10 });
    expect((await moveStock({ fromId: floorId, toId: depo, lines: [{ productId: soap, quantity: 4 }] })).status).toBe(201);
    const full = await api().delete(`/api/locations/${depo}`).set(auth(ownerToken));
    expect(full.status).toBe(409);
    expect(full.body.error?.message ?? JSON.stringify(full.body)).toContain('Move them out first');
    expect((await api().delete(`/api/locations/${floorId}`).set(auth(ownerToken))).status).toBe(409);

    await moveStock({ fromId: depo, toId: floorId, lines: [{ productId: soap, quantity: 4 }] });
    expect((await api().delete(`/api/locations/${depo}`).set(auth(ownerToken))).status).toBe(200);
    expect((await api().get('/api/locations').set(auth())).body.data).toHaveLength(1);
    // The last one stays.
    const solo = await api().delete(`/api/locations/${floorId}`).set(auth(ownerToken));
    expect(solo.status).toBe(409);
    // A removed name can be used again.
    await addDepo('Depoja e vogël');
  });

  it('moves stock in one step, numbered LV-, without changing the total or the books', async () => {
    const depo = await addDepo();
    const soap = await createTestProduct(context, adminToken, { name: 'Sapun', price: 2, costPrice: 1, stock: 10 });
    const entriesBefore = (await context.db.selectFrom('ledger_entries').select('id').execute()).length;

    const moved = await moveStock({ fromId: floorId, toId: depo, note: 'Në depo', lines: [{ productId: soap, quantity: 6 }] });
    expect(moved.status, JSON.stringify(moved.body)).toBe(201);
    expect(moved.body.data).toMatchObject({ number: `LV-${today().slice(0, 4)}-000001`, from: 'Shop floor', to: 'Depo', lineCount: 1, units: 6 });
    expect(await stockOf(context, soap)).toBe(10);
    expect(await where(soap)).toEqual({ 'Shop floor': 4, Depo: 6 });

    // More than the location holds is refused; the employee can't move stock.
    const tooMany = await moveStock({ fromId: floorId, toId: depo, lines: [{ productId: soap, quantity: 5 }] });
    expect(tooMany.status).toBe(409);
    expect(JSON.stringify(tooMany.body)).toContain('Only 4 of Sapun at Shop floor');
    expect((await moveStock({ fromId: floorId, toId: depo, lines: [{ productId: soap, quantity: 1 }] }, employeeToken)).status).toBe(403);
    expect((await moveStock({ fromId: depo, toId: depo, lines: [{ productId: soap, quantity: 1 }] })).status).toBe(400);

    // Voiding moves it back; the books never moved.
    const voided = await api().post(`/api/stock-moves/${moved.body.data.id}/void`).set(auth(ownerToken));
    expect(voided.status).toBe(200);
    expect(await where(soap)).toEqual({ 'Shop floor': 10 });
    expect((await api().post(`/api/stock-moves/${moved.body.data.id}/void`).set(auth(ownerToken))).status).toBe(409);
    await new BooksPoster(context.db, shopTimeZone()).rebuild();
    expect((await context.db.selectFrom('ledger_entries').select('id').execute()).length).toBe(entriesBefore);
    const posted = await context.db.selectFrom('ledger_entries').select('source_key').where('source_key', 'like', 'adjustment:%').execute();
    expect(posted).toEqual([]);

    const list = await api().get('/api/stock-moves').set(auth(employeeToken)).query({ startDate: today(), endDate: today() });
    expect(list.body.data).toHaveLength(1);
    const csv = await api().get('/api/exports/stock-moves.csv').set(auth()).query({ startDate: today(), endDate: today() });
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('Sapun');
    expect(csv.text).toContain('Depo');
    await expectSumsMatch();
  });

  it('a void that would take back what was sold since is refused', async () => {
    const depo = await addDepo();
    const soap = await createTestProduct(context, adminToken, { name: 'Sapun', stock: 5, costPrice: 1 });
    await moveStock({ fromId: floorId, toId: depo, lines: [{ productId: soap, quantity: 5 }] });
    const back = await moveStock({ fromId: depo, toId: floorId, lines: [{ productId: soap, quantity: 3 }] });
    await api().post('/api/sales').set(auth()).send({ productId: soap, quantity: 3 });
    const voided = await api().post(`/api/stock-moves/${back.body.data.id}/void`).set(auth(ownerToken));
    expect(voided.status).toBe(409);
    expect(await where(soap)).toEqual({ Depo: 2 });
  });

  it('a sale takes from the floor first, then from storage, and says so on the stock movement', async () => {
    const depo = await addDepo();
    const soap = await createTestProduct(context, adminToken, { name: 'Sapun', price: 2, costPrice: 1, stock: 10 });
    await moveStock({ fromId: floorId, toId: depo, lines: [{ productId: soap, quantity: 8 }] });

    const sale = await api().post('/api/sales').set(auth(employeeToken)).send({ productId: soap, quantity: 5 });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(await stockOf(context, soap)).toBe(5);
    expect(await where(soap)).toEqual({ Depo: 5 });

    const history = (await api().get(`/api/inventory/${soap}`).set(auth())).body.data.recentAdjustments;
    const sold = history.filter((row: { reason: string }) => row.reason === 'Sale');
    expect(sold).toHaveLength(2);
    expect(sold.map((row: { quantity: number; location: string; notes: string }) => [row.quantity, row.location, row.notes.includes('from Depo')]).sort()).toEqual([
      [-2, 'Shop floor', false],
      [-3, 'Depo', true],
    ]);

    // Undoing the sale puts it back where the till sells.
    const entry = await context.db.selectFrom('activity_log').select('id').where('action', '=', 'sale.recorded').orderBy('id', 'desc').executeTakeFirstOrThrow();
    const undone = await api().post(`/api/activity/${entry.id}/undo`).set(auth()).send({});
    expect(undone.status, JSON.stringify(undone.body)).toBe(200);
    expect(await where(soap)).toEqual({ 'Shop floor': 5, Depo: 5 });
    await expectSumsMatch();
  });

  it('selling past stock applies to the total, not one location', async () => {
    const depo = await addDepo();
    const soap = await createTestProduct(context, adminToken, { name: 'Sapun', stock: 4 });
    await moveStock({ fromId: floorId, toId: depo, lines: [{ productId: soap, quantity: 4 }] });
    // Blocked: 4 in the shop (all in storage) is still enough for 4.
    expect((await api().post('/api/sales').set(auth()).send({ productId: soap, quantity: 4 })).status).toBe(201);
    expect((await api().post('/api/sales').set(auth(employeeToken)).send({ productId: soap, quantity: 1 })).status).not.toBe(201);
    await api().put('/api/settings/rules').set(auth()).send({ noStockSales: 'allow' });
    expect((await api().post('/api/sales').set(auth(employeeToken)).send({ productId: soap, quantity: 2 })).status).toBe(201);
    expect(await stockOf(context, soap)).toBe(0);
    await expectSumsMatch();
  });

  it('bills, stock documents, write-offs and counts use the location picked, or a sensible default', async () => {
    const depo = await addDepo();
    await api().patch(`/api/locations/${depo}`).set(auth(ownerToken)).send({ receivesHere: true });
    const soap = await createTestProduct(context, adminToken, { name: 'Sapun', price: 2, costPrice: 1, stock: 0 });
    const supplierId = (await api().post('/api/suppliers').set(auth()).send({ name: 'Fresh Foods', nui: '811234567' })).body.data.id;

    // A bill with no location goes where goods are received (now the Depo).
    const bill = await api()
      .post('/api/bills')
      .set(auth())
      .send({ supplierId, issuedOn: today(), dueOn: null, number: 'B-1', lines: [{ kind: 'product', productId: soap, quantity: 10, unitPrice: 1 }] });
    expect(bill.status, JSON.stringify(bill.body)).toBe(201);
    expect(await where(soap)).toEqual({ Depo: 10 });
    // One picking the floor goes there.
    await api()
      .post('/api/bills')
      .set(auth())
      .send({ supplierId, issuedOn: today(), dueOn: null, number: 'B-2', locationId: floorId, lines: [{ kind: 'product', productId: soap, quantity: 3, unitPrice: 1 }] });
    expect(await where(soap)).toEqual({ Depo: 10, 'Shop floor': 3 });
    // Voiding the first takes it back out of the Depo.
    expect((await api().post(`/api/bills/${bill.body.data.id}/void`).set(auth()).send({ note: 'wrong' })).status).toBe(200);
    expect(await where(soap)).toEqual({ 'Shop floor': 3 });

    // Stock in at the Depo; stock out defaults to the floor.
    const stockIn = await api().post('/api/stock-documents').set(auth()).send({ direction: 'in', reason: 'found', day: today(), locationId: depo, lines: [{ productId: soap, quantity: 7 }] });
    expect(stockIn.body.data).toMatchObject({ locationId: depo, locationName: 'Depo' });
    await api().post('/api/stock-documents').set(auth()).send({ direction: 'out', reason: 'own_use', day: today(), lines: [{ productId: soap, quantity: 1 }] });
    expect(await where(soap)).toEqual({ 'Shop floor': 2, Depo: 7 });

    // A write-off of the Depo comes out of the Depo.
    const writeOff = await api().post('/api/write-offs').set(auth()).send({ productId: soap, quantity: 2, reason: 'damaged', notes: 'Broken', locationId: depo });
    expect(writeOff.status, JSON.stringify(writeOff.body)).toBe(201);
    expect(await where(soap)).toEqual({ 'Shop floor': 2, Depo: 5 });

    // A count of the Depo compares with the Depo only.
    const started = await api().post('/api/stock-counts').set(auth()).send({ locationId: depo });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    expect(started.body.data.location).toEqual({ id: depo, name: 'Depo' });
    const countId = started.body.data.id;
    // Counting the floor at the same time is fine: another location.
    expect((await api().post('/api/stock-counts').set(auth()).send({})).status).toBe(201);
    await api().put(`/api/stock-counts/${countId}/lines/${soap}`).set(auth()).send({ countedQuantity: 4 });
    const line = (await api().get(`/api/stock-counts/${countId}`).set(auth())).body.data.lines.find((row: { productId: number }) => row.productId === soap);
    expect(line).toMatchObject({ expectedQuantity: 5, difference: -1 });
    await api().post(`/api/stock-counts/${countId}/submit`).set(auth());
    expect((await api().post(`/api/stock-counts/${countId}/lines/${soap}/approve`).set(auth())).status).toBe(200);
    expect(await where(soap)).toEqual({ 'Shop floor': 2, Depo: 4 });
    await expectSumsMatch();
  });

  it('the stock list carries each location and what to refill from storage', async () => {
    const depo = await addDepo();
    const soap = await createTestProduct(context, adminToken, { name: 'Sapun', stock: 10 });
    await moveStock({ fromId: floorId, toId: depo, lines: [{ productId: soap, quantity: 8 }] });
    const set = await api().put(`/api/locations/products/${soap}`).set(auth(ownerToken)).send({ locationId: floorId, minimum: 5 });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.data).toEqual([
      { id: floorId, name: 'Shop floor', sellsHere: true, quantity: 2, shelfMinimum: 5 },
      { id: depo, name: 'Depo', sellsHere: false, quantity: 8, shelfMinimum: null },
    ]);
    const rows = (await api().get('/api/reports/reorder-suggestions').set(auth())).body.data;
    const row = rows.find((item: { productId: number }) => item.productId === soap);
    expect(row).toMatchObject({ quantity: 10, refill: 3 });
    expect(row.places).toEqual(
      expect.arrayContaining([
        { locationId: floorId, quantity: 2, shelfMinimum: 5 },
        { locationId: depo, quantity: 8, shelfMinimum: null },
      ]),
    );
  });

  it('merging duplicates keeps each location’s stock', async () => {
    const depo = await addDepo();
    const keep = await createTestProduct(context, adminToken, { name: 'Sapun', stock: 3 });
    const drop = await createTestProduct(context, adminToken, { name: 'Sapun i dyfishtë', stock: 5 });
    await moveStock({ fromId: floorId, toId: depo, lines: [{ productId: drop, quantity: 4 }] });
    await new DuplicateRepository(context.db).merge({ keepId: keep, dropId: drop, dropStock: 5, reorderLevel: 2 });
    expect(await where(keep)).toEqual({ 'Shop floor': 4, Depo: 4 });
    await expectSumsMatch();
  });
});

describe('the locations migration', () => {
  it('puts all of today’s stock into one location, Shop floor, and adds up', async () => {
    const soap = await createTestProduct(context, adminToken, { name: 'Sapun', stock: 7 });
    const oil = await createTestProduct(context, adminToken, { name: 'Vaj', stock: 2.5, unit: 'l' });
    await dropLocations(context.db as never);
    try {
      await sql`UPDATE inventory SET quantity_on_hand = 9 WHERE product_id = ${soap}`.execute(context.db);
      await addLocations(context.db as never);
      expect(await context.db.selectFrom('stock_locations').select(['name', 'sells_here', 'receives_here']).execute()).toEqual([
        { name: 'Shop floor', sells_here: true, receives_here: true },
      ]);
      expect(await where(soap)).toEqual({ 'Shop floor': 9 });
      expect(await where(oil)).toEqual({ 'Shop floor': 2.5 });
      const adjustments = await context.db.selectFrom('stock_adjustments').select('location_id').execute();
      expect(adjustments.length).toBeGreaterThan(0);
      expect(adjustments.every((row) => row.location_id === 1)).toBe(true);
      await expectSumsMatch();
    } finally {
      // Leave the schema as every other test expects it.
      const present = await sql<{ n: number }>`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'stock_locations'`.execute(context.db);
      if (present.rows[0]!.n === 0) await addLocations(context.db as never);
    }
  });
});
