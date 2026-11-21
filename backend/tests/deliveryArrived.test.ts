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
