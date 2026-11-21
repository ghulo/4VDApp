import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BillPage, BillReader, BillReading } from '../src/services/ai/billReader.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

/** Hands back the reading the test sets, or fails like a reader that can't be reached. */
class FakeReader implements BillReader {
  reading!: BillReading;
  failing = false;
  async read(_pages: BillPage[]): Promise<BillReading> {
    if (this.failing) throw new Error('The reader is down');
    return this.reading;
  }
}

const reader = new FakeReader();
let context: TestContext;
let adminToken: string;
let ownerToken: string;
let staffToken: string;
let supplierId: number;
let chairId: number;
let tableId: number;

beforeAll(async () => {
  context = await setupTestApp({ billReader: reader });
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
  ownerToken = await loginAs(context, 'owner');
  staffToken = await loginAs(context, 'employee');
  supplierId = (await api().post('/api/suppliers').set(auth()).send({ name: 'Fresh Foods', nui: '811234567' })).body.data.id;
  chairId = await createTestProduct(context, adminToken, { name: 'Oak Chair', costPrice: 60, stock: 10 });
  tableId = await createTestProduct(context, adminToken, { name: 'Oak Table', costPrice: 200, stock: 0 });
  reader.failing = false;
  reader.reading = reading();
});
afterAll(() => context.db.destroy());

const api = () => request(context.app);
const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function reading(lines: Array<{ name: string; quantity: number; unitPrice: number }> = [{ name: 'Oak Chair', quantity: 3, unitPrice: 50 }]): BillReading {
  return {
    supplier: { name: 'Fresh Foods LLC', nui: '811234567' },
    number: 'FF-90',
    issuedOn: today(),
    dueOn: null,
    pricesIncludeVat: true,
    lines: lines.map((line) => ({ code: null, barcode: null, unit: 'copë', unitsPerPack: null, discountPercent: null, vatRate: 18, lineTotal: null, ...line })),
    totals: { net: null, vat: null, gross: lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) },
    remarks: null,
  };
}

const stockOf = async (productId: number) => (await api().get(`/api/products/${productId}`).set(auth())).body.data.stock.quantity;
const order = async (id: number) => (await api().get(`/api/orders/${id}`).set(auth())).body.data;

function arrive(body: Record<string, unknown> = {}, token = staffToken) {
  return api()
    .post('/api/orders/arrived')
    .set(auth(token))
    .send({ key: randomUUID(), supplierId, lines: [{ productId: chairId, quantity: 3, expiresOn: null }], ...body });
}

async function photo(orderId: number, token = staffToken) {
  const response = await api().post('/api/bill-scans').set(auth(token)).send({ pages: [{ mime: 'image/png', data: PNG }], arrivedOrderId: orderId });
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  return response.body.data as { id: number };
}

const confirmBody = (orderId: number | null, lines: Array<Record<string, unknown>>, amount = 150) => ({
  supplierId,
  orderId,
  categoryId: null,
  bill: { number: 'FF-90', issuedOn: today(), dueOn: null, amount, vatAmount: null, note: null },
  lines: lines.map((line) => ({ productId: chairId, newProduct: null, code: null, pieces: 3, unitsPerPack: 1, unitCost: 50, updateCost: false, barcode: null, updateBarcode: false, ...line })),
});

describe('a delivery that came without an order', () => {
  it('should let staff pick the supplier by name only and put what came into stock at once', async () => {
    const names = await api().get('/api/orders/delivery-suppliers').set(auth(staffToken));
    expect(names.body.data).toEqual([{ id: supplierId, name: 'Fresh Foods' }]);

    const response = await arrive({ lines: [{ productId: chairId, quantity: 3, expiresOn: '2027-01-31' }, { productId: tableId, quantity: 1, expiresOn: null }] });

    expect(response.status).toBe(201);
    expect(await stockOf(chairId)).toBe(13);
    expect(await stockOf(tableId)).toBe(1);
    // An order made and received in one go, at the cost each product had: the bill sets the real one.
    const made = await order(response.body.data.id);
    expect(made.status).toBe('received');
    expect(made.lines.map((line: { productId: number; receivedQuantity: number; unitCost: number }) => [line.productId, line.receivedQuantity, line.unitCost])).toEqual([
      [chairId, 3, 60],
      [tableId, 1, 200],
    ]);
    expect(made.bill).toBeNull();
    const dated = await context.db.selectFrom('expiry_dates').select(['product_id', 'quantity']).where('product_id', '=', chairId).execute();
    expect(dated).toEqual([{ product_id: chairId, quantity: 3 }]);
  });

  it('should tell the owner in Updates with a link to the delivery, and not the staff member', async () => {
    const { id } = (await arrive()).body.data;

    const notes = await context.db
      .selectFrom('notifications as n')
      .innerJoin('users as u', 'u.id', 'n.user_id')
      .select(['u.email', 'n.link', 'n.type', 'n.title'])
      .where('n.type', '=', 'delivery_arrived')
      .execute();
    expect(notes.map((note) => note.email).sort()).toEqual(['admin@test.local', 'owner@test.local']);
    expect(notes[0]).toMatchObject({ link: `/orders/${id}`, title: 'Delivery from Fresh Foods, without an order' });
  });

  it('should put the goods in once when the same press arrives twice, also at the same moment', async () => {
    const key = randomUUID();
    const first = await arrive({ key });
    const again = await arrive({ key });
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({ id: first.body.data.id, repeated: true });

    const both = await Promise.all([arrive({ key: randomUUID() }), arrive({ key: randomUUID() })]);
    const sameKey = randomUUID();
    const twins = await Promise.all([arrive({ key: sameKey }), arrive({ key: sameKey })]);
    expect(both.map((response) => response.status)).toEqual([201, 201]);
    expect(new Set(twins.map((response) => response.body.data.id)).size).toBe(1);
    // 10 + 3 (first) + 3 + 3 (both) + 3 (twins, once).
    expect(await stockOf(chairId)).toBe(22);
  });

  it('should refuse a product twice, nothing at all, a product that does not exist, and pieces in parts', async () => {
    expect((await arrive({ lines: [{ productId: chairId, quantity: 1 }, { productId: chairId, quantity: 2 }] })).status).toBe(400);
    expect((await arrive({ lines: [] })).status).toBe(400);
    expect((await arrive({ lines: [{ productId: 999999, quantity: 1 }] })).status).toBe(404);
    expect((await arrive({ lines: [{ productId: chairId, quantity: 1.5 }] })).status).toBe(400);
    expect(await stockOf(chairId)).toBe(10);
    expect(await context.db.selectFrom('purchase_orders').select('id').execute()).toEqual([]);
  });

  it('should keep the counter and the accountant apart: the accountant may not put goods in', async () => {
    const accountantToken = await loginAs(context, 'accountant');
    expect((await arrive({}, accountantToken)).status).toBe(403);
    expect((await arrive({}, ownerToken)).status).toBe(201);
  });
});

describe('the bill photographed with it', () => {
  it('should take the bill of an ordered delivery staff ticked off too, without putting its goods in again', async () => {
    const ordered = (await api().post('/api/orders').set(auth()).send({ supplierId, lines: [{ productId: chairId, quantity: 4, unitCost: 60 }] })).body.data;
    await api().post(`/api/orders/${ordered.id}/receive`).set(auth(staffToken)).send({ lines: [{ lineId: ordered.lines[0].id, receivedQuantity: 4 }] }).expect(200);
    const { id } = await photo(ordered.id);

    await api().post(`/api/bill-scans/${id}/confirm`).set(auth()).send(confirmBody(null, [{ pieces: 4, unitCost: 55 }], 220)).expect(200);

    expect(await stockOf(chairId)).toBe(14);
    expect((await order(ordered.id)).lines[0]).toMatchObject({ receivedQuantity: 4, unitCost: 55 });
  });

  it('should wait in To do for its supplier, showing what staff counted and no order to fill', async () => {
    const { id: orderId } = (await arrive()).body.data;
    const { id } = await photo(orderId);

    const scan = (await api().get(`/api/bill-scans/${id}`).set(auth())).body.data;
    expect(scan.supplier).toMatchObject({ id: supplierId, name: 'Fresh Foods' });
    expect(scan.openOrders).toEqual([]);
    expect(scan.arrival).toMatchObject({ orderId, lines: [{ productId: chairId, productName: 'Oak Chair', quantity: 3 }] });
    // Sent again (an answer lost on the way): the same scan, not a second one.
    expect((await photo(orderId)).id).toBe(id);
    expect(await context.db.selectFrom('bill_scans').select('id').execute()).toHaveLength(1);
  });

  it('should set the costs and save the bill on confirm without putting the counted goods in again', async () => {
    const { id: orderId } = (await arrive()).body.data;
    const { id } = await photo(orderId);

    const response = await api().post(`/api/bill-scans/${id}/confirm`).set(auth(ownerToken)).send(confirmBody(null, [{ unitCost: 50, updateCost: true }]));

    expect(response.status).toBe(200);
    expect(response.body.data.orderId).toBe(orderId);
    expect(await stockOf(chairId)).toBe(13);
    const filled = await order(orderId);
    expect(filled.status).toBe('received');
    expect(filled.lines[0]).toMatchObject({ receivedQuantity: 3, unitCost: 50 });
    expect(filled.bill).toMatchObject({ id: response.body.data.billId, amount: 150 });
    expect((await api().get(`/api/products/${chairId}`).set(auth())).body.data.costPrice).toBe(50);
  });

  it("should put in what is on the bill but wasn't counted, and keep the staff count where they differ", async () => {
    reader.reading = reading([
      { name: 'Oak Chair', quantity: 5, unitPrice: 50 },
      { name: 'Oak Table', quantity: 1, unitPrice: 180 },
    ]);
    const { id: orderId } = (await arrive()).body.data;
    const { id } = await photo(orderId);

    await api()
      .post(`/api/bill-scans/${id}/confirm`)
      .set(auth())
      .send(confirmBody(orderId, [{ pieces: 5 }, { productId: tableId, pieces: 1, unitCost: 180 }], 430))
      .expect(200);

    expect(await stockOf(chairId)).toBe(13);
    expect(await stockOf(tableId)).toBe(1);
    expect((await order(orderId)).lines).toHaveLength(2);
  });

  it('should not add the goods twice through the phone check either', async () => {
    const { id: orderId } = (await arrive()).body.data;
    const { id } = await photo(orderId);
    const quick = (await api().get(`/api/bill-scans/${id}/quick`).set(auth())).body.data;
    expect(quick.input.orderId).toBe(orderId);

    await api().post(`/api/bill-scans/${id}/quick-confirm`).set(auth()).expect(200);

    expect(await stockOf(chairId)).toBe(13);
    expect((await order(orderId)).bill).not.toBeNull();
  });

  it("should keep a photo the reader couldn't read, and save its bill from the figures alone", async () => {
    reader.failing = true;
    const { id: orderId } = (await arrive()).body.data;
    const { id } = await photo(orderId);
    const scan = (await api().get(`/api/bill-scans/${id}`).set(auth())).body.data;
    expect(scan.lines).toEqual([]);
    expect(scan.reading.supplier.name).toBe('Fresh Foods');

    await api().post(`/api/bill-scans/${id}/confirm`).set(auth()).send(confirmBody(null, [], 180)).expect(200);

    expect(await stockOf(chairId)).toBe(13);
    expect((await order(orderId)).bill).toMatchObject({ amount: 180 });
  });

  it('should refuse another supplier, another order, a bill already added by hand, and a photo for an ordinary order', async () => {
    const otherSupplier = (await api().post('/api/suppliers').set(auth()).send({ name: 'Other Co', nui: '811234568' })).body.data.id;
    const ordinary = (await api().post('/api/orders').set(auth()).send({ supplierId, lines: [{ productId: chairId, quantity: 1, unitCost: 60 }] })).body.data;
    const { id: orderId } = (await arrive()).body.data;
    const { id } = await photo(orderId);

    expect((await api().post(`/api/bill-scans/${id}/confirm`).set(auth()).send({ ...confirmBody(null, [{}]), supplierId: otherSupplier })).status).toBe(400);
    expect((await api().post(`/api/bill-scans/${id}/confirm`).set(auth()).send(confirmBody(ordinary.id, [{}]))).status).toBe(400);
    await api().post('/api/bills').set(auth()).send({ supplierId, orderId, issuedOn: today(), amount: 150 }).expect(201);
    expect((await api().post(`/api/bill-scans/${id}/confirm`).set(auth()).send(confirmBody(null, [{}]))).status).toBe(409);
    expect(await stockOf(chairId)).toBe(13);

    // An order still on its way: tick it off first.
    const refused = await api().post('/api/bill-scans').set(auth(staffToken)).send({ pages: [{ mime: 'image/png', data: PNG }], arrivedOrderId: ordinary.id });
    expect(refused.status).toBe(400);
    // Its bill already added: no photo for it.
    const billed = await api().post('/api/bill-scans').set(auth(staffToken)).send({ pages: [{ mime: 'image/png', data: PNG }], arrivedOrderId: orderId });
    expect(billed.status).toBe(409);
  });

  it('should reopen by putting back only what the confirm did: costs, the bill and the goods it added', async () => {
    const developerToken = await loginAs(context, 'developer');
    reader.reading = reading([
      { name: 'Oak Chair', quantity: 3, unitPrice: 50 },
      { name: 'Oak Table', quantity: 1, unitPrice: 180 },
    ]);
    const { id: orderId } = (await arrive()).body.data;
    const { id } = await photo(orderId);
    const confirmed = (await api().post(`/api/bill-scans/${id}/confirm`).set(auth()).send(confirmBody(null, [{}, { productId: tableId, pieces: 1, unitCost: 180 }], 330))).body.data;

    await api().post(`/api/bill-scans/${id}/reopen`).set(auth(developerToken)).expect(200);

    // Staff's count stays in stock and the delivery stays received; the table the bill added goes back out.
    expect(await stockOf(chairId)).toBe(13);
    expect(await stockOf(tableId)).toBe(0);
    const back = await order(orderId);
    expect(back.status).toBe('received');
    expect(back.lines).toHaveLength(1);
    expect(back.lines[0]).toMatchObject({ receivedQuantity: 3, unitCost: 60 });
    expect(back.bill).toBeNull();
    expect((await api().get(`/api/bills/${confirmed.billId}`).set(auth())).body.data.status).toBe('void');

    // Checked again, it confirms like the first time.
    await api().post(`/api/bill-scans/${id}/confirm`).set(auth()).send(confirmBody(null, [{}])).expect(200);
    expect(await stockOf(chairId)).toBe(13);
  });
});

describe('review fixes: replays, races, zero lines, the accountant', () => {
  it('should refuse a resend whose counts changed after the first copy went in', async () => {
    const key = randomUUID();
    await arrive({ key }).expect(201);
    const changed = await arrive({ key, lines: [{ productId: chairId, quantity: 5, expiresOn: null }] });
    expect(changed.status).toBe(409);
    expect(changed.body.message).toMatch(/already put into stock with other counts/);
    expect((await arrive({ key })).status).toBe(200);
    expect(await stockOf(chairId)).toBe(13);
  });

  it('should take an ordered delivery ticked off twice at once only once, and answer the same resend with success', async () => {
    const ordered = (await api().post('/api/orders').set(auth()).send({ supplierId, lines: [{ productId: chairId, quantity: 4, unitCost: 60 }] })).body.data;
    const keys = { 4: randomUUID(), 3: randomUUID() } as Record<number, string>;
    const send = (quantity: number, key = keys[quantity]) =>
      api().post(`/api/orders/${ordered.id}/receive`).set(auth(staffToken)).send({ requestKey: key, lines: [{ lineId: ordered.lines[0].id, receivedQuantity: quantity }] });

    const both = await Promise.all([send(4), send(3)]);
    expect(both.map((response) => response.status).sort()).toEqual([200, 409]);
    const count = (await order(ordered.id)).lines[0].receivedQuantity;
    expect(await stockOf(chairId)).toBe(10 + count);

    // The winner's answer lost on the way and sent again: done, nothing added.
    expect((await send(count)).status).toBe(200);
    // The loser's press, or the winner's key with other counts: refused.
    expect((await send(count === 4 ? 3 : 4)).status).toBe(409);
    expect((await send(count === 4 ? 3 : 4, keys[count])).status).toBe(409);
    expect(await stockOf(chairId)).toBe(10 + count);
  });

  it('should put a line ticked off as 0 into stock from the bill, and take it back out on reopen', async () => {
    const developerToken = await loginAs(context, 'developer');
    const ordered = (await api().post('/api/orders').set(auth()).send({ supplierId, lines: [{ productId: chairId, quantity: 4, unitCost: 60 }, { productId: tableId, quantity: 1, unitCost: 200 }] })).body.data;
    await api()
      .post(`/api/orders/${ordered.id}/receive`)
      .set(auth(staffToken))
      .send({ lines: [{ lineId: ordered.lines[0].id, receivedQuantity: 0 }, { lineId: ordered.lines[1].id, receivedQuantity: 1 }] })
      .expect(200);
    const { id } = await photo(ordered.id);

    await api()
      .post(`/api/bill-scans/${id}/confirm`)
      .set(auth())
      .send(confirmBody(null, [{ pieces: 4, unitCost: 55 }, { productId: tableId, pieces: 1, unitCost: 190 }], 410))
      .expect(200);
    expect(await stockOf(chairId)).toBe(14);
    expect(await stockOf(tableId)).toBe(1);
    expect((await order(ordered.id)).lines.map((line: { receivedQuantity: number; unitCost: number }) => [line.receivedQuantity, line.unitCost])).toEqual([
      [4, 55],
      [1, 190],
    ]);

    await api().post(`/api/bill-scans/${id}/reopen`).set(auth(developerToken)).expect(200);
    expect(await stockOf(chairId)).toBe(10);
    expect((await order(ordered.id)).lines.map((line: { receivedQuantity: number; unitCost: number }) => [line.receivedQuantity, line.unitCost])).toEqual([
      [0, 60],
      [1, 200],
    ]);
  });

  it("should let the accountant check and save a delivery's bill, but not put goods in or add products", async () => {
    const accountantToken = await loginAs(context, 'accountant');
    reader.reading = reading([
      { name: 'Oak Chair', quantity: 3, unitPrice: 50 },
      { name: 'Oak Table', quantity: 1, unitPrice: 180 },
    ]);
    const { id: orderId } = (await arrive()).body.data;
    const { id } = await photo(orderId);
    const todo = (await api().get('/api/attention').set(auth(accountantToken))).body.data.todo;
    expect(todo.map((item: { key: string }) => item.key)).toContain(`bill_scan:${id}`);
    expect((await api().get(`/api/bill-scans/${id}`).set(auth(accountantToken))).status).toBe(200);

    // The table wasn't counted: putting it in is the owner's.
    const withTable = await api().post(`/api/bill-scans/${id}/confirm`).set(auth(accountantToken)).send(confirmBody(null, [{}, { productId: tableId, pieces: 1, unitCost: 180 }], 330));
    expect(withTable.status).toBe(403);
    const newProduct = await api()
      .post(`/api/bill-scans/${id}/confirm`)
      .set(auth(accountantToken))
      .send(confirmBody(null, [{ productId: null, newProduct: { name: 'Pine Stool', barcode: null, price: 30, vatRate: 18 } }]));
    expect(newProduct.status).toBe(403);
    expect(await stockOf(tableId)).toBe(0);

    await api().post(`/api/bill-scans/${id}/confirm`).set(auth(accountantToken)).send(confirmBody(null, [{}], 150)).expect(200);
    expect((await order(orderId)).bill).toMatchObject({ amount: 150 });
    expect(await stockOf(chairId)).toBe(13);

    // An ordinary scan (goods not in yet) stays the owner's.
    reader.reading = reading();
    const ordinary = (await api().post('/api/bill-scans').set(auth(staffToken)).send({ pages: [{ mime: 'image/png', data: PNG }] })).body.data;
    expect((await api().post(`/api/bill-scans/${ordinary.id}/confirm`).set(auth(accountantToken)).send(confirmBody(null, [{}]))).status).toBe(403);
    expect((await api().post(`/api/bill-scans/${ordinary.id}/discard`).set(auth(accountantToken))).status).toBe(403);
  });

  it('should flag a bill that names another supplier and keep it off the phone check', async () => {
    await api().post('/api/suppliers').set(auth()).send({ name: 'Other Co', nui: '811234568' }).expect(201);
    reader.reading = { ...reading(), supplier: { name: 'Other Co', nui: '811234568' } };
    const { id: orderId } = (await arrive()).body.data;
    const { id } = await photo(orderId);

    expect((await api().get(`/api/bill-scans/${id}`).set(auth())).body.data.arrival.billSupplier).toBe('Other Co');
    expect((await api().get(`/api/bill-scans/${id}/quick`).set(auth())).body.data.blockers).toContain('supplier');
  });
});

describe('second review fixes', () => {
  /** How much of a product each location holds, by location name. */
  async function where(productId: number): Promise<Record<string, number>> {
    const rows = await context.db
      .selectFrom('location_stock as s')
      .innerJoin('stock_locations as l', 'l.id', 's.location_id')
      .select(['l.name', 's.quantity'])
      .where('s.product_id', '=', productId)
      .execute();
    return Object.fromEntries(rows.filter((row) => Number(row.quantity) !== 0).map((row) => [row.name, Number(row.quantity)]));
  }
  const openDates = async (productId: number) =>
    (await context.db.selectFrom('expiry_dates').select('id').where('product_id', '=', productId).where('cleared_at', 'is', null).execute()).length;
  const receive = (orderId: number, body: Record<string, unknown>, token = staffToken) => api().post(`/api/orders/${orderId}/receive`).set(auth(token)).send(body);
  const twoLineOrder = async () =>
    (await api().post('/api/orders').set(auth()).send({ supplierId, lines: [{ productId: chairId, quantity: 4, unitCost: 60 }, { productId: tableId, quantity: 1, unitCost: 200 }] })).body.data;

  it('should reopen from the place the confirm put the goods, and clear the best-before dates it added', async () => {
    const developerToken = await loginAs(context, 'developer');
    const depo = (await api().post('/api/locations').set(auth(ownerToken)).send({ name: 'Depo' })).body.data.id;
    await api().patch(`/api/locations/${depo}`).set(auth(ownerToken)).send({ receivesHere: true }).expect(200);
    const ordered = await twoLineOrder();
    await receive(ordered.id, { lines: [{ lineId: ordered.lines[0].id, receivedQuantity: 0 }, { lineId: ordered.lines[1].id, receivedQuantity: 1 }] }).expect(200);
    const { id } = await photo(ordered.id);

    // No place picked: the chairs on the bill go where goods are received.
    await api()
      .post(`/api/bill-scans/${id}/confirm`)
      .set(auth())
      .send(confirmBody(null, [{ pieces: 4, unitCost: 55, expiresOn: '2027-03-01' }, { productId: tableId, pieces: 1, unitCost: 190 }], 410))
      .expect(200);
    expect(await where(chairId)).toEqual({ 'Shop floor': 10, Depo: 4 });
    expect(await openDates(chairId)).toBe(1);

    await api().post(`/api/bill-scans/${id}/reopen`).set(auth(developerToken)).expect(200);
    // They leave the depot again; the shop floor's own chairs stay.
    expect(await where(chairId)).toEqual({ 'Shop floor': 10 });
    expect(await openDates(chairId)).toBe(0);
  });

  it('should answer a resend of a delivery by what it first sent: another best-before date is refused, a bill added since is not', async () => {
    const key = randomUUID();
    const first = { key, lines: [{ productId: chairId, quantity: 3, expiresOn: '2027-01-31' }] };
    const { id: orderId } = (await arrive(first).expect(201)).body.data;
    const otherDate = await arrive({ key, lines: [{ productId: chairId, quantity: 3, expiresOn: null }] });
    expect(otherDate.status).toBe(409);

    // The bill brings a table staff didn't count; the very same press sent again is still "done".
    const { id } = await photo(orderId);
    await api().post(`/api/bill-scans/${id}/confirm`).set(auth()).send(confirmBody(null, [{}, { productId: tableId, pieces: 1, unitCost: 180 }], 330)).expect(200);
    expect((await arrive(first)).status).toBe(200);
    expect(await stockOf(chairId)).toBe(13);
    expect(await stockOf(tableId)).toBe(1);
  });

  it('should answer a lost ordered tick-off by what it sent, even after its bill filled a line ticked off as 0', async () => {
    const ordered = await twoLineOrder();
    const press = { requestKey: randomUUID(), lines: [{ lineId: ordered.lines[0].id, receivedQuantity: 0 }, { lineId: ordered.lines[1].id, receivedQuantity: 1 }] };
    await receive(ordered.id, press).expect(200);
    const { id } = await photo(ordered.id);
    await api().post(`/api/bill-scans/${id}/confirm`).set(auth()).send(confirmBody(null, [{ pieces: 4 }, { productId: tableId, pieces: 1, unitCost: 190 }], 390)).expect(200);

    expect((await receive(ordered.id, press)).status).toBe(200);
    expect(await stockOf(chairId)).toBe(14);
    expect(await stockOf(tableId)).toBe(1);
  });

  it("should keep the accountant off products' costs and the supplier's codes", async () => {
    const accountantToken = await loginAs(context, 'accountant');
    const { id: orderId } = (await arrive()).body.data;
    const { id } = await photo(orderId);

    const withCost = await api().post(`/api/bill-scans/${id}/confirm`).set(auth(accountantToken)).send(confirmBody(null, [{ updateCost: true, unitCost: 50 }]));
    expect(withCost.status).toBe(403);
    expect(withCost.body.message).toMatch(/what a product costs/);

    await api().post(`/api/bill-scans/${id}/confirm`).set(auth(accountantToken)).send(confirmBody(null, [{ code: 'FF-CH-1' }])).expect(200);
    expect((await api().get(`/api/products/${chairId}`).set(auth())).body.data.costPrice).toBe(60);
    const codes = await context.db.selectFrom('supplier_product_codes').select('code').where('supplier_id', '=', supplierId).execute();
    expect(codes).toEqual([]);
  });

  it('should refuse a second tick-off that brings a bill or other details, not answer it with "done"', async () => {
    const ordered = (await api().post('/api/orders').set(auth()).send({ supplierId, lines: [{ productId: chairId, quantity: 4, unitCost: 60 }] })).body.data;
    const lines = [{ lineId: ordered.lines[0].id, receivedQuantity: 4 }];
    await receive(ordered.id, { requestKey: randomUUID(), lines }).expect(200);

    // The owner's form, same count, with the bill typed in: nothing is dropped quietly.
    const withBill = await receive(ordered.id, { requestKey: randomUUID(), lines, bill: { number: 'FF-1', issuedOn: today(), amount: 240 } }, adminToken);
    expect(withBill.status).toBe(409);
    expect(withBill.body.message).toMatch(/already ticked off/);
    const noKey = await receive(ordered.id, { lines }, adminToken);
    expect(noKey.status).toBe(409);
    expect((await order(ordered.id)).bill).toBeNull();
    expect(await stockOf(chairId)).toBe(14);
  });

  it('should never cancel an order a delivery was ticked off on at the same moment', async () => {
    for (let round = 0; round < 3; round += 1) {
      const ordered = (await api().post('/api/orders').set(auth()).send({ supplierId, lines: [{ productId: chairId, quantity: 2, unitCost: 60 }] })).body.data;
      const before = await stockOf(chairId);
      const [cancelled, received] = await Promise.all([
        api().post(`/api/orders/${ordered.id}/cancel`).set(auth()),
        receive(ordered.id, { requestKey: randomUUID(), lines: [{ lineId: ordered.lines[0].id, receivedQuantity: 2 }] }),
      ]);
      expect([cancelled.status, received.status].sort()).toEqual([200, 409]);
      const after = await order(ordered.id);
      // Whichever came first, the order and the stock agree.
      expect(after.status).toBe(received.status === 200 ? 'received' : 'cancelled');
      expect(await stockOf(chairId)).toBe(before + (received.status === 200 ? 2 : 0));
    }
  });
});
