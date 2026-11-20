import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let productId: number;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  await seedBooks(context.db as never);
  adminToken = await loginAs(context, 'admin');
  productId = await createTestProduct(context, adminToken, { price: 100, costPrice: 50, stock: 10, vatRate: 18 });
});
afterAll(() => context.db.destroy());

const auth = () => ({ Authorization: `Bearer ${adminToken}` });
const api = () => request(context.app);
const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const today = () => day();
const month = (date: string) => date.slice(0, 7);

interface Entry {
  kind: string;
  date: string;
  source: string | null;
  reversed: boolean;
  lines: Array<{ accountNumber: string; debit: number; credit: number }>;
}
const readLines = (entry: Entry) => entry.lines.map((line) => `${line.accountNumber} ${line.debit > 0 ? `Dr ${line.debit}` : `Cr ${line.credit}`}`).sort();
async function entriesFor(billId: number): Promise<Entry[]> {
  const response = await api().get(`/api/books/entries?source=bill&id=${billId}`).set(auth());
  expect(response.status).toBe(200);
  return response.body.data;
}
const standing = (entries: Entry[]) => entries.filter((entry) => entry.kind === 'auto' && !entry.reversed);

async function vatBoxes(on = today()) {
  const response = await api().get(`/api/vat/${month(on)}`).set(auth());
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.data.boxes as Record<string, number>;
}
const costOf = async () => Number((await context.db.selectFrom('products').select('cost_price').where('id', '=', productId).executeTakeFirstOrThrow()).cost_price);
const setStock = (quantity: number) => context.db.updateTable('inventory').set({ quantity_on_hand: quantity }).where('product_id', '=', productId).execute();

/** A delivery of 10 units at €11.80 from a supplier abroad, received with its bill (no customs on it). */
async function importByOrder(issuedOn = today()): Promise<number> {
  const supplier = await api().post('/api/suppliers').set(auth()).send({ name: 'Istanbul Toys', nui: '', abroad: true });
  expect(supplier.status).toBe(201);
  const order = await api().post('/api/orders').set(auth()).send({ supplierId: supplier.body.data.id, lines: [{ productId, quantity: 10, unitCost: 11.8 }] });
  expect(order.status, JSON.stringify(order.body)).toBe(201);
  const received = await api()
    .post(`/api/orders/${order.body.data.id}/receive`)
    .set(auth())
    .send({ lines: [{ lineId: order.body.data.lines[0].id, receivedQuantity: 10, unitCost: 11.8 }], bill: { number: 'IT-1', issuedOn, dueOn: null, amount: 118 } });
  expect(received.status, JSON.stringify(received.body)).toBe(200);
  return (await context.db.selectFrom('supplier_bills').select('id').where('order_id', '=', order.body.data.id).executeTakeFirstOrThrow()).id;
}

const putCustoms = (billId: number, body: Record<string, unknown>) =>
  api().put(`/api/bills/${billId}/customs`).set(auth()).send({ number: 'DUD-1', issuedOn: today(), vat: 23.04, duty: 10, method: 'bank', ...body });

describe('customs put on a saved import bill', () => {
  it('takes customs on a bill made by receiving an order: VAT claimed, duty onto the goods and their cost, paid from the bank', async () => {
    const billId = await importByOrder();
    const before = await costOf();
    const response = await putCustoms(billId, {});
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data).toMatchObject({ vatToClaim: 23.04, customs: { vat: 23.04, duty: 10, excise: 0, method: 'bank', number: 'DUD-1', issuedOn: today() } });
    expect(response.body.data.lines[0].landed).toBe(128);
    // All 10 units still on the shelf: €1 duty each, with the product's 18% back on as 4VD keeps costs.
    expect(await costOf()).toBe(Math.round((before + 1.18) * 100) / 100);

    const [bill, customs] = standing(await entriesFor(billId));
    expect(readLines(bill!)).toEqual(['1340 Dr 118', '2000 Cr 118']);
    expect(readLines(customs!)).toEqual(['1120 Cr 33.04', '1260 Dr 23.04', '1340 Dr 10']);
    const boxes = await vatBoxes();
    expect([boxes[31], boxes[35], boxes[36]]).toEqual([0, 128, 23.04]);
  });

  it('puts duty that comes after some units were sold onto the units still in stock', async () => {
    const billId = await importByOrder();
    const before = await costOf();
    await setStock(4);
    expect((await putCustoms(billId, { duty: 10 })).status).toBe(200);
    // €10 over the 4 left: €2.50 each, €2.95 with VAT as 4VD keeps costs.
    expect(await costOf()).toBe(Math.round((before + 2.95) * 100) / 100);
  });

  it('sends the duty to cost of sales when none of the units are left', async () => {
    const billId = await importByOrder();
    const before = await costOf();
    await setStock(0);
    expect((await putCustoms(billId, { duty: 10, excise: 2 })).status).toBe(200);
    expect(await costOf()).toBe(before);
    const customs = standing(await entriesFor(billId)).find((entry) => entry.source?.startsWith('customs:'))!;
    expect(readLines(customs)).toEqual(['1120 Cr 35.04', '1260 Dr 23.04', '5000 Dr 12']);
  });

  it('moves the cost again when the customs change, and back when they are removed', async () => {
    const billId = await importByOrder();
    const before = await costOf();
    expect((await putCustoms(billId, { duty: 10 })).status).toBe(200);
    expect((await putCustoms(billId, { duty: 20, vat: 25 })).status).toBe(200);
    expect(await costOf()).toBe(Math.round((before + 2.36) * 100) / 100);
    const changed = standing(await entriesFor(billId)).find((entry) => entry.source?.startsWith('customs:'))!;
    expect(readLines(changed)).toEqual(['1120 Cr 45', '1260 Dr 25', '1340 Dr 20']);

    const removed = await api().delete(`/api/bills/${billId}/customs`).set(auth());
    expect(removed.status).toBe(200);
    expect(removed.body.data).toMatchObject({ customs: null, vatToClaim: 0 });
    expect(removed.body.data.lines[0].landed).toBe(118);
    expect(await costOf()).toBe(before);
    expect(standing(await entriesFor(billId)).filter((entry) => entry.source?.startsWith('customs:'))).toEqual([]);
    expect((await vatBoxes())[36]).toBe(0);
  });

  it('counts the customs VAT in the month of the customs paper, not the bill', async () => {
    const lastMonth = new Date();
    lastMonth.setUTCDate(1);
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    const billDay = lastMonth.toISOString().slice(0, 10);
    const billId = await importByOrder(billDay);
    expect((await putCustoms(billId, { issuedOn: today() })).status).toBe(200);
    const thenBoxes = await vatBoxes(billDay);
    expect([thenBoxes[31], thenBoxes[35], thenBoxes[36]]).toEqual([0, 0, 0]);
    const nowBoxes = await vatBoxes();
    expect([nowBoxes[35], nowBoxes[36]]).toEqual([128, 23.04]);
    const customs = standing(await entriesFor(billId)).find((entry) => entry.source?.startsWith('customs:'))!;
    expect(customs.date).toBe(today());
  });

  it('counts a paper dated in a filed month in the next open one, and writes nothing into the filed month', async () => {
    const lastMonth = new Date();
    lastMonth.setUTCDate(1);
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    const billDay = lastMonth.toISOString().slice(0, 10);
    const billId = await importByOrder(billDay);
    const billEntries = await entriesFor(billId);
    await context.db.insertInto('vat_months').values({ month: billDay, filed_at: new Date(), filed_by: null, figures: JSON.stringify({}), refund: 0 }).execute();
    const response = await putCustoms(billId, { issuedOn: billDay });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data.customs.vatMonth).toBe(month(today()));
    const after = await entriesFor(billId);
    // The bill's own entry stays as it was; only the customs entry is new, on the first day of the open month.
    expect(after.filter((entry) => !entry.source?.startsWith('customs:'))).toEqual(billEntries);
    const customs = after.find((entry) => entry.source?.startsWith('customs:'))!;
    expect(customs.date).toBe(`${month(today())}-01`);
    expect((await vatBoxes())[36]).toBe(23.04);
    // Changing it later is still allowed: it counts in the open month.
    expect((await putCustoms(billId, { issuedOn: billDay, vat: 20 })).status).toBe(200);
  });

  it('refuses customs on a bill from a supplier at home', async () => {
    const supplier = await api().post('/api/suppliers').set(auth()).send({ name: 'Local Ltd', nui: '811234599' });
    const saved = await api()
      .post('/api/bills')
      .set(auth())
      .send({ supplierId: supplier.body.data.id, issuedOn: today(), dueOn: null, number: null, lines: [{ kind: 'product', productId, quantity: 1, unitPrice: 10 }] });
    expect(saved.status).toBe(201);
    expect(saved.body.data.customsAllowed).toBe(false);
    expect((await putCustoms(saved.body.data.id, {})).status).toBe(409);
  });

  it("won't change the duty on equipment after the bill is saved", async () => {
    const supplier = await api().post('/api/suppliers').set(auth()).send({ name: 'Milano Machines', nui: '', abroad: true });
    const saved = await api()
      .post('/api/bills')
      .set(auth())
      .send({ supplierId: supplier.body.data.id, issuedOn: today(), dueOn: null, number: null, lines: [{ kind: 'equipment', category: 'equipment', amount: 1000 }] });
    expect(saved.status).toBe(201);
    expect((await putCustoms(saved.body.data.id, { duty: 50 })).status).toBe(400);
    // The VAT alone can go on.
    expect((await putCustoms(saved.body.data.id, { duty: 0, vat: 180 })).status).toBe(200);
  });

  it('lets the paper go when its bill is voided, so it waits for the bill entered again', async () => {
    const supplier = await api().post('/api/suppliers').set(auth()).send({ name: 'Istanbul Toys', nui: '', abroad: true });
    const saved = await api()
      .post('/api/bills')
      .set(auth())
      .send({ supplierId: supplier.body.data.id, issuedOn: today(), dueOn: null, number: 'IT-9', lines: [{ kind: 'product', productId, quantity: 2, unitPrice: 10 }] });
    expect((await putCustoms(saved.body.data.id, {})).status).toBe(200);
    expect((await api().post(`/api/bills/${saved.body.data.id}/void`).set(auth()).send({ note: 'Typed twice' })).status).toBe(200);
    const paper = await context.db.selectFrom('customs_papers').select(['bill_id', 'voided_at']).executeTakeFirstOrThrow();
    expect(paper).toEqual({ bill_id: null, voided_at: null });
    const todo = (await api().get('/api/attention').set(auth())).body.data.todo as Array<{ kind: string }>;
    expect(todo.some((item) => item.kind === 'customs_waiting')).toBe(true);
  });
});

describe('the customs reminder', () => {
  const kinds = async () => ((await api().get('/api/attention').set(auth())).body.data.todo as Array<{ kind: string; title: string }>).filter((item) => item.kind === 'customs_missing');

  it('asks for the customs a week after an import bill, and stops once it is added or marked as none', async () => {
    const fresh = await importByOrder(day(-2));
    expect(await kinds()).toEqual([]);
    await context.db.updateTable('supplier_bills').set({ issued_on: day(-8) }).where('id', '=', fresh).execute();
    const asked = await kinds();
    expect(asked).toHaveLength(1);
    expect(asked[0]!.title).toBe('Customs missing for Istanbul Toys IT-1');

    const none = await api().put(`/api/bills/${fresh}/no-customs`).set(auth()).send({ value: true });
    expect(none.status).toBe(200);
    expect(none.body.data.noCustoms).toBe(true);
    expect(await kinds()).toEqual([]);

    await api().put(`/api/bills/${fresh}/no-customs`).set(auth()).send({ value: false });
    expect(await kinds()).toHaveLength(1);
    expect((await putCustoms(fresh, { issuedOn: day(-8) })).status).toBe(200);
    expect(await kinds()).toEqual([]);
  });
});
