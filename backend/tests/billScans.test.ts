import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BillPage, BillReader, BillReading } from '../src/services/ai/billReader.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

/** Hands back whatever reading the test sets, and remembers what it was sent. */
class FakeReader implements BillReader {
  reading!: BillReading;
  sent: BillPage[][] = [];
  async read(pages: BillPage[]): Promise<BillReading> {
    this.sent.push(pages);
    return this.reading;
  }
}

const reader = new FakeReader();
let context: TestContext;
let adminToken: string;
let staffToken: string;
let supplierId: number;
let chairId: number;
let categoryId: number;

beforeAll(async () => {
  context = await setupTestApp({ billReader: reader });
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
  staffToken = await loginAs(context, 'employee');
  supplierId = (await api().post('/api/suppliers').set(auth()).send({ name: 'Fresh Foods', nui: '811234567' })).body.data.id;
  chairId = await createTestProduct(context, adminToken, { name: 'Oak Chair', costPrice: 60, stock: 10 });
  await context.db.updateTable('products').set({ barcode: '3800000000011' }).where('id', '=', chairId).execute();
  categoryId = (await context.db.selectFrom('categories').select('id').executeTakeFirstOrThrow()).id;
  reader.sent = [];
  reader.reading = reading();
});
afterAll(() => context.db.destroy());

const api = () => request(context.app);
const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });

// A 1x1 PNG is enough for the photo path; the fake reader never looks at it.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PDF = Buffer.from('%PDF-1.4\n%fake\n').toString('base64');

function reading(lines: Partial<BillReading['lines'][number]>[] = [{}], extra: Partial<BillReading> = {}): BillReading {
  const full = lines.map((line) => ({
    code: 'ART-1',
    barcode: '3800000000011',
    name: 'Oak Chair',
    quantity: 2,
    unit: 'copë',
    unitsPerPack: null,
    unitPrice: 60,
    discountPercent: null,
    vatRate: 18,
    lineTotal: null,
    ...line,
  }));
  const net = full.reduce((sum, line) => sum + (line.unitPrice ?? 0) * line.quantity * (1 - (line.discountPercent ?? 0) / 100), 0);
  return {
    supplier: { name: 'Fresh Foods LLC', nui: '811234567' },
    number: 'FF-77',
    issuedOn: today(),
    dueOn: null,
    pricesIncludeVat: false,
    lines: full,
    totals: { net, vat: null, gross: null },
    remarks: null,
    ...extra,
  };
}

async function scan(token = adminToken, pages = [{ mime: 'image/png', data: PNG }]) {
  const response = await api().post('/api/bill-scans').set(auth(token)).send({ pages });
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  return response.body.data as { id: number; supplierName: string | null; number: string | null; lines: number };
}

const check = async (id: number, query = '') => (await api().get(`/api/bill-scans/${id}${query}`).set(auth())).body.data;

function confirmBody(lines: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return {
    supplierId,
    orderId: null,
    categoryId: null,
    bill: { number: 'FF-77', issuedOn: today(), dueOn: null, amount: 120, note: null },
    lines: lines.map((line) => ({
      productId: chairId,
      newProduct: null,
      code: 'ART-1',
      pieces: 2,
      unitsPerPack: 1,
      unitCost: 60,
      updateCost: false,
      barcode: null,
      updateBarcode: false,
      ...line,
    })),
    ...extra,
  };
}

const stockOf = async (productId: number) => (await api().get(`/api/products/${productId}`).set(auth())).body.data.stock.quantity;

describe('scanned supplier bills', () => {
  it('should let staff scan a bill without seeing costs, and put it on the To do list for the owner', async () => {
    const receipt = await scan(staffToken);
    expect(receipt).toEqual({ id: receipt.id, supplierName: 'Fresh Foods LLC', number: 'FF-77', lines: 1 });
    expect(reader.sent[0]![0]!.mime).toBe('image/webp');

    expect((await api().get(`/api/bill-scans/${receipt.id}`).set(auth(staffToken))).status).toBe(403);
    const waiting = (await api().get('/api/bill-scans').set(auth())).body.data;
    expect(waiting).toMatchObject([{ id: receipt.id, supplierName: 'Fresh Foods LLC', number: 'FF-77' }]);

    const todo = (await api().get('/api/attention').set(auth())).body.data.todo as Array<{ kind: string; to: string }>;
    expect(todo.find((item) => item.kind === 'bill_scan')).toMatchObject({ to: `/bills/scans/${receipt.id}` });
  });

  it('should stamp each line: matching, new price, new barcode and new product', async () => {
    reader.reading = reading([
      {},
      { code: 'ART-2', barcode: '3800000000099', name: 'Oak Chair', unitPrice: 60, quantity: 1 },
      { code: 'ART-3', barcode: null, name: 'Oak Chair', unitPrice: 75, quantity: 1 },
      { code: 'ART-4', barcode: '3800000000555', name: 'Mango juice 1L', unitPrice: 1.2, quantity: 12 },
    ]);
    const { id } = await scan();
    const result = await check(id);

    expect(result.supplier).toMatchObject({ id: supplierId, matchedBy: 'nui' });
    expect(result.lines.map((line: { match: { stamp: string } }) => line.match.stamp)).toEqual(['match', 'barcode', 'price', 'new']);
    expect(result.lines[2].match).toMatchObject({ productId: chairId, unitCost: 75, oldCost: 60 });
    expect(result.totals.adds).toBe(true);
    expect(result.pages).toHaveLength(1);
  });

  it('should take rabat, VAT-inclusive prices and box sizes into the cost of one piece', async () => {
    reader.reading = reading([{ quantity: 2, unitsPerPack: 6, unitPrice: 141.6, discountPercent: 10 }], { pricesIncludeVat: true });
    const { id } = await scan();
    const [line] = (await check(id)).lines;
    // 141.60 with 18% VAT is 120 net, minus 10% rabat is 108, for a box of 6: 18 a piece.
    expect(line.match).toMatchObject({ unitsPerPack: 6, pieces: 12, unitCost: 18 });
  });

  it('should confirm a scan: add the new product, update the barcode, receive the stock and save the bill', async () => {
    reader.reading = reading([{ barcode: '3800000000099' }, { code: 'ART-4', barcode: '3800000000555', name: 'Mango juice', unitPrice: 1.2, quantity: 12 }]);
    const { id } = await scan();

    const response = await api()
      .post(`/api/bill-scans/${id}/confirm`)
      .set(auth())
      .send(
        confirmBody(
          [
            { barcode: '3800000000099', updateBarcode: true, unitCost: 55, updateCost: true },
            { productId: null, newProduct: { name: 'Mango juice', barcode: '3800000000555', price: 2, vatRate: 18 }, code: 'ART-4', pieces: 12, unitCost: 1.2 },
          ],
          { categoryId },
        ),
      );
    expect(response.status).toBe(200);
    const { billId, orderId } = response.body.data;

    const chair = (await api().get(`/api/products/${chairId}`).set(auth())).body.data;
    expect(chair.stock.quantity).toBe(12);
    expect(chair).toMatchObject({ barcode: '3800000000099', costPrice: 55 });
    const order = (await api().get(`/api/orders/${orderId}`).set(auth())).body.data;
    expect(order.status).toBe('received');
    const bill = (await api().get(`/api/bills/${billId}`).set(auth())).body.data;
    expect(bill).toMatchObject({ number: 'FF-77', amount: 120, orderId });
    expect(bill.photoUrl).toBeTruthy();

    const mango = await context.db.selectFrom('products').select('id').where('name', '=', 'Mango juice').executeTakeFirstOrThrow();
    expect(await stockOf(mango.id)).toBe(12);

    // Confirmed once; the scan is no longer waiting and a second confirm is refused.
    expect((await api().get('/api/bill-scans').set(auth())).body.data).toEqual([]);
    expect((await api().post(`/api/bill-scans/${id}/confirm`).set(auth()).send(confirmBody([{}]))).status).toBe(409);
  });

  it("should remember the supplier's code and box size so the next bill matches by itself", async () => {
    reader.reading = reading([{ code: 'XQ-9', barcode: null, name: 'Karrige lisi', quantity: 1, unitPrice: 300 }]);
    const first = await scan();
    expect((await check(first.id)).lines[0].match.stamp).toBe('new');
    await api()
      .post(`/api/bill-scans/${first.id}/confirm`)
      .set(auth())
      .send(confirmBody([{ code: 'XQ-9', pieces: 4, unitsPerPack: 4, unitCost: 75 }]));

    const second = await scan();
    const [line] = (await check(second.id)).lines;
    expect(line.match).toMatchObject({ productId: chairId, matchedBy: 'code', unitsPerPack: 4, pieces: 4, unitCost: 75 });
  });

  it('should fill an open order from that supplier, adding what was not on it', async () => {
    const tableId = await createTestProduct(context, adminToken, { name: 'Oak Table', costPrice: 200, stock: 0 });
    const order = (await api().post('/api/orders').set(auth()).send({ supplierId, lines: [{ productId: chairId, quantity: 5, unitCost: 60 }] })).body.data;
    const { id } = await scan();
    expect((await check(id)).openOrders.map((open: { id: number }) => open.id)).toEqual([order.id]);

    const response = await api()
      .post(`/api/bill-scans/${id}/confirm`)
      .set(auth())
      .send(confirmBody([{ pieces: 3 }, { productId: tableId, code: 'ART-9', pieces: 1, unitCost: 200 }], { orderId: order.id }));
    expect(response.body.data.orderId).toBe(order.id);
    expect(await stockOf(chairId)).toBe(13);
    expect(await stockOf(tableId)).toBe(1);
    const received = (await api().get(`/api/orders/${order.id}`).set(auth())).body.data;
    expect(received.status).toBe('received');
    expect(received.lines).toHaveLength(2);
  });

  it('should warn about a bill number already saved, and about lines that do not add up to the total', async () => {
    await api().post('/api/bills').set(auth()).send({ supplierId, number: 'FF-77', issuedOn: today(), amount: 120 });
    reader.reading = reading([{}], { totals: { net: 150, vat: null, gross: null } });
    const { id } = await scan();
    const result = await check(id);
    expect(result.duplicateBillId).not.toBeNull();
    expect(result.totals).toMatchObject({ linesTotal: 120, printedTotal: 150, adds: false });
  });

  it('should keep PDFs whole, refuse other files, and let a scan be discarded', async () => {
    const { id } = await scan(adminToken, [{ mime: 'application/pdf', data: PDF }]);
    expect(reader.sent[0]![0]!.mime).toBe('application/pdf');
    expect((await check(id)).pages[0].isPdf).toBe(true);

    const fakePdf = await api()
      .post('/api/bill-scans')
      .set(auth())
      .send({ pages: [{ mime: 'application/pdf', data: Buffer.from('not a pdf').toString('base64') }] });
    expect(fakePdf.status).toBe(400);

    expect((await api().post(`/api/bill-scans/${id}/discard`).set(auth())).status).toBe(200);
    expect((await api().get('/api/bill-scans').set(auth())).body.data).toEqual([]);
    expect((await api().post(`/api/bill-scans/${id}/discard`).set(auth())).status).toBe(409);
  });

  it('should need a category before adding new products, and change nothing when refused', async () => {
    const { id } = await scan();
    const response = await api()
      .post(`/api/bill-scans/${id}/confirm`)
      .set(auth())
      .send(confirmBody([{}, { productId: null, newProduct: { name: 'Mango juice', barcode: null, price: 2, vatRate: 18 } }]));
    expect(response.status).toBe(400);
    expect(await stockOf(chairId)).toBe(10);
    expect((await api().get('/api/bill-scans').set(auth())).body.data).toHaveLength(1);
  });

  it('should let only the developer reopen a confirmed scan, putting stock, bill, order, cost, barcode and codes back', async () => {
    const developerToken = await loginAs(context, 'developer');
    const order = (await api().post('/api/orders').set(auth()).send({ supplierId, lines: [{ productId: chairId, quantity: 5, unitCost: 60 }] })).body.data;
    reader.reading = reading([{ barcode: '3800000000099' }, { code: 'ART-4', barcode: null, name: 'Mango juice', unitPrice: 1.2, quantity: 12 }]);
    const { id } = await scan();
    const lines = [
      { readIndex: 0, barcode: '3800000000099', updateBarcode: true, unitCost: 55, updateCost: true },
      { readIndex: 1, productId: null, newProduct: { name: 'Mango juice', barcode: null, price: 2, vatRate: 18 }, code: 'ART-4', pieces: 12, unitCost: 1.2 },
    ];
    const confirmed = (await api().post(`/api/bill-scans/${id}/confirm`).set(auth()).send(confirmBody(lines, { categoryId, orderId: order.id }))).body.data;
    await api().post(`/api/bills/${confirmed.billId}/payments`).set(auth()).send({ paidOn: today(), method: 'bank', amount: 20 });
    expect(await stockOf(chairId)).toBe(12);

    expect((await api().post(`/api/bill-scans/${id}/reopen`).set(auth())).status).toBe(403);
    const reopened = await api().post(`/api/bill-scans/${id}/reopen`).set(auth(developerToken));
    expect(reopened.status).toBe(200);

    const chair = (await api().get(`/api/products/${chairId}`).set(auth())).body.data;
    expect(chair.stock.quantity).toBe(10);
    expect(chair).toMatchObject({ barcode: '3800000000011', costPrice: 60 });
    expect(await context.db.selectFrom('products').select('id').where('name', '=', 'Mango juice').where('deleted_at', 'is', null).executeTakeFirst()).toBeUndefined();
    expect((await api().get(`/api/bills/${confirmed.billId}`).set(auth())).body.data).toMatchObject({ status: 'void', paid: 0 });
    const back = (await api().get(`/api/orders/${order.id}`).set(auth())).body.data;
    expect(back.status).toBe('open');
    expect(back.lines).toHaveLength(1);
    expect(await context.db.selectFrom('supplier_product_codes').selectAll().execute()).toEqual([]);

    // Waiting again, with the earlier choices to start from; confirming again works.
    const history = (await api().get(`/api/activity/history?entityType=bill_scan&entityId=${id}`).set(auth())).body.data.map((entry: { action: string }) => entry.action);
    expect(history).toEqual(['bill.scanned', 'bill.scan_confirmed', 'bill.scan_reopened']);
    const again = await check(id);
    expect(again.status).toBe('waiting');
    expect(again.previous.lines[0]).toMatchObject({ readIndex: 0, unitCost: 55 });
    expect((await api().post(`/api/bill-scans/${id}/confirm`).set(auth()).send(confirmBody([{ pieces: 2 }], { orderId: order.id }))).status).toBe(200);
    expect(await stockOf(chairId)).toBe(12);
  });

  it('should refuse to reopen when part of the delivery was already sold', async () => {
    const developerToken = await loginAs(context, 'developer');
    const { id } = await scan();
    await api().post(`/api/bill-scans/${id}/confirm`).set(auth()).send(confirmBody([{}]));
    await context.db.updateTable('inventory').set({ quantity_on_hand: 1 }).where('product_id', '=', chairId).execute();
    expect((await api().post(`/api/bill-scans/${id}/reopen`).set(auth(developerToken))).status).toBe(409);
    expect((await check(id)).status).toBe('confirmed');
  });
});

describe('checking a scanned bill on the phone', () => {
  it("should tell the people who run the shop when someone else scans a bill, and clear it once it's confirmed", async () => {
    const { id } = await scan(staffToken);
    const alerts = () =>
      context.db.selectFrom('notifications').select(['is_read']).where('subject_type', '=', 'bill_scan').where('subject_id', '=', id).execute();
    expect((await alerts()).length).toBeGreaterThan(0);

    const quick = (await api().get(`/api/bill-scans/${id}/quick`).set(auth())).body.data;
    expect(quick.blockers).toEqual([]);
    expect(quick.lines[0]).toMatchObject({ product: 'Oak Chair', pieces: 2, stamp: 'match' });
    await api().post(`/api/bill-scans/${id}/quick-confirm`).set(auth()).expect(200);

    expect((await alerts()).every((alert) => alert.is_read)).toBe(true);
    const stock = await context.db.selectFrom('inventory').select('quantity_on_hand').where('product_id', '=', chairId).executeTakeFirstOrThrow();
    expect(stock.quantity_on_hand).toBe(12);
  });

  it('should send a bill with a new product to the dashboard', async () => {
    reader.reading = reading([{}, { name: 'Pine Shelf', barcode: null, code: 'ART-9' }]);
    const { id } = await scan();
    const quick = (await api().get(`/api/bill-scans/${id}/quick`).set(auth())).body.data;
    expect(quick.blockers).toContain('new_product');
    expect(quick.input).toBeNull();
    await api().post(`/api/bill-scans/${id}/quick-confirm`).set(auth()).expect(409);
  });

  it('should not alert anyone when the scanner runs the shop', async () => {
    const { id } = await scan();
    const rows = await context.db.selectFrom('notifications').select('id').where('subject_type', '=', 'bill_scan').where('subject_id', '=', id).execute();
    expect(rows).toHaveLength(0);
  });
});
