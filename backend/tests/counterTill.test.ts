import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let employeeToken: string;
let productId: number;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  await seedBooks(context.db as never);
  adminToken = await loginAs(context, 'admin');
  employeeToken = await loginAs(context, 'employee');
  productId = await createTestProduct(context, adminToken, { price: 10, costPrice: 6, stock: 50, vatRate: 18 });
});
afterAll(() => context.db.destroy());

const api = () => request(context.app);
const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const day = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });
const PERIOD = `from=${day()}&to=${day()}`;

const sell = (body: Record<string, unknown>, token = employeeToken) =>
  api().post('/api/sales/basket').set(auth(token)).send({ items: [{ productId, quantity: 2 }], notes: null, ...body });

async function entryLines(invoiceId: number): Promise<string[]> {
  const response = await api().get(`/api/books/entries?source=document&id=${invoiceId}`).set(auth());
  expect(response.status).toBe(200);
  return response.body.data
    .filter((entry: { reversed: boolean; kind: string }) => !entry.reversed && entry.kind !== 'reversal')
    .flatMap((entry: { lines: Array<{ accountNumber: string; debit: number; credit: number }> }) =>
      entry.lines.map((line) => `${line.accountNumber} ${line.debit > 0 ? `Dr ${line.debit}` : `Cr ${line.credit}`}`),
    )
    .sort();
}

describe('paying at the counter by card', () => {
  it('puts a card sale in the bank, not the drawer', async () => {
    const card = await sell({ paidBy: 'card' });
    expect(card.status).toBe(201);
    await sell({});

    const invoice = (await api().get(`/api/documents/${card.body.data.invoice.id}`).set(auth())).body.data;
    expect(invoice.paymentMethod).toBe('card');
    expect(await entryLines(card.body.data.invoice.id)).toEqual(expect.arrayContaining(['1120 Dr 20']));
    expect(await entryLines(card.body.data.invoice.id)).not.toEqual(expect.arrayContaining(['1110 Dr 20']));

    const places = (await api().get('/api/money/places').set(auth())).body.data as Array<{ id: number; kind: string; carwashId: number | null; isDefault: boolean }>;
    const till = places.find((place) => place.kind === 'till' && place.carwashId === null)!;
    const bank = places.find((place) => place.kind === 'bank' && place.isDefault)!;
    const tillBook = (await api().get(`/api/money/places/${till.id}/book?${PERIOD}`).set(auth())).body.data;
    const bankBook = (await api().get(`/api/money/places/${bank.id}/book?${PERIOD}`).set(auth())).body.data;
    expect(tillBook.lines.map((line: { kind: string; amount: number }) => [line.kind, line.amount])).toEqual([['takings', 20]]);
    expect(bankBook.lines.map((line: { kind: string; amount: number }) => [line.kind, line.amount])).toEqual([['card', 20]]);

    // The drawer holds the €50 float and the cash sale only.
    const count = await api().post('/api/cash-counts').set(auth()).send({ counted: 70, place: 'shop' });
    expect(count.body.data).toMatchObject({ expected: 20, difference: 0 });
  });

  it('refuses a card on a sale put on a tab', async () => {
    const customer = (await api().post('/api/customers').set(auth()).send({ name: 'Arben' })).body.data;
    expect((await sell({ customerId: customer.id, paidNow: false, paidBy: 'card' }, adminToken)).status).toBe(400);
    expect((await sell({ customerId: customer.id, paidNow: true, paidBy: 'card' }, adminToken)).status).toBe(201);
  });
});

describe('part cash, part card', () => {
  it('puts the card part in the bank and the rest in the drawer', async () => {
    const split = await sell({ cardAmount: 12.5 });
    expect(split.status).toBe(201);
    const invoiceId = split.body.data.invoice.id;
    const invoice = (await api().get(`/api/documents/${invoiceId}`).set(auth())).body.data;
    expect(invoice).toMatchObject({ paymentMethod: 'till', cardAmount: 12.5, total: 20 });
    expect(await entryLines(invoiceId)).toEqual(expect.arrayContaining(['1110 Dr 7.5', '1120 Dr 12.5']));

    const places = (await api().get('/api/money/places').set(auth())).body.data as Array<{ id: number; kind: string; carwashId: number | null; isDefault: boolean }>;
    const till = places.find((place) => place.kind === 'till' && place.carwashId === null)!;
    const bank = places.find((place) => place.kind === 'bank' && place.isDefault)!;
    const book = async (id: number) =>
      (await api().get(`/api/money/places/${id}/book?${PERIOD}`).set(auth())).body.data.lines.map((line: { kind: string; amount: number }) => [line.kind, line.amount]);
    expect(await book(till.id)).toEqual([['takings', 7.5]]);
    expect(await book(bank.id)).toEqual([['card', 12.5]]);

    const me = (await api().get('/api/counter/today').set(auth(employeeToken))).body.data.mine;
    expect(me).toMatchObject({ receipts: 1, total: 20, cash: 7.5, card: 12.5 });
    const receipt = (await api().get(`/api/counter/receipts?number=${split.body.data.invoice.number}`).set(auth(employeeToken))).body.data[0];
    expect(receipt).toMatchObject({ paidBy: 'split', cardAmount: 12.5 });
  });

  it('refuses a card part of the whole total, with a card sale, or on a tab', async () => {
    expect((await sell({ cardAmount: 20 })).status).toBe(400);
    expect((await sell({ cardAmount: 5, paidBy: 'card' })).status).toBe(400);
    const customer = (await api().post('/api/customers').set(auth()).send({ name: 'Arben' })).body.data;
    expect((await sell({ cardAmount: 5, customerId: customer.id, paidNow: false }, adminToken)).status).toBe(400);
    expect((await sell({ cardAmount: 5, customerId: customer.id, paidNow: true }, adminToken)).status).toBe(201);
  });
});

describe('finding a receipt to give something back', () => {
  it("lists today's receipts and finds one by its number, with what is left to give back", async () => {
    const first = (await sell({ paidBy: 'card' })).body.data;
    const second = (await sell({}, adminToken)).body.data;
    await api().post(`/api/sales/${first.sales[0].id}/returns`).set(auth(employeeToken)).send({ quantity: 1, condition: 'resellable', notes: null });

    const today = (await api().get('/api/counter/receipts').set(auth(employeeToken))).body.data;
    expect(today.map((receipt: { number: string }) => receipt.number)).toEqual([second.invoice.number, first.invoice.number]);

    const found = await api().get(`/api/counter/receipts?number=${first.invoice.number.toLowerCase()}`).set(auth(employeeToken));
    expect(found.body.data).toEqual([
      expect.objectContaining({
        number: first.invoice.number,
        total: 20,
        paidBy: 'card',
        soldBy: 'Test employee',
        lines: [expect.objectContaining({ productId, quantity: 2, pricePerUnit: 10, returnedQuantity: 1, undone: false })],
      }),
    ]);
    expect((await api().get('/api/counter/receipts?number=F-1999-000001').set(auth(employeeToken))).body.data).toEqual([]);
    expect((await api().get('/api/counter/receipts?day=1999-01-01').set(auth(employeeToken))).body.data).toEqual([]);
    expect((await api().get('/api/counter/receipts?day=yesterday').set(auth(employeeToken))).status).toBe(400);
  });
});

describe('the counter shelf', () => {
  it('hands over every product on sale in one answer, without costs', async () => {
    const hidden = await createTestProduct(context, adminToken, { name: 'Old stock', isActive: false, price: 2 });
    const tiered = await createTestProduct(context, adminToken, { name: 'Apa 0.5L', price: 0.5, bulkPricingTiers: [{ quantity: 6, price: 0.4 }] });
    const shelf = await api().get('/api/counter/shelf').set(auth(employeeToken));
    expect(shelf.status).toBe(200);
    const ids = shelf.body.data.map((product: { id: number }) => product.id);
    expect(ids).toEqual(expect.arrayContaining([productId, tiered]));
    expect(ids).not.toContain(hidden);
    const water = shelf.body.data.find((product: { id: number }) => product.id === tiered);
    expect(water.bulkPricingTiers).toEqual([{ quantity: 6, price: 0.4 }]);
    expect(water.stock.quantity).toBe(10);
    expect(water.otherBarcodes).toEqual([]);
    expect(shelf.body.data.every((product: Record<string, unknown>) => !('costPrice' in product))).toBe(true);
    expect((await api().get('/api/counter/shelf')).status).toBe(401);
  });
});

describe('counter settings', () => {
  it("starts from the printer's TREFIN set-up and lets a manager change it", async () => {
    const defaults = await api().get('/api/counter/settings').set(auth(employeeToken));
    expect(defaults.body.data).toEqual({
      receiptFooter: 'Ju faleminderit!',
      printer: { enabled: false, taxGroups: { '18': 5, '16': null, '8': 4, '0': null } },
      drawerConnected: false,
      scanSounds: true,
      customerDisplay: true,
    });
    const changed = { receiptFooter: 'Faleminderit, ju presim sërish!', printer: { enabled: true, taxGroups: { '18': 5, '16': 3, '8': 4, '0': 1 } }, drawerConnected: true, scanSounds: false, customerDisplay: false };
    expect((await api().put('/api/counter/settings').set(auth(employeeToken)).send(changed)).status).toBe(403);
    const saved = await api().put('/api/counter/settings').set(auth()).send(changed);
    expect(saved.status).toBe(200);
    expect(saved.body.data).toEqual(changed);
    expect((await api().put('/api/counter/settings').set(auth()).send({ ...changed, printer: { enabled: true, taxGroups: { ...changed.printer.taxGroups, '18': 9 } } })).status).toBe(400);
  });
});

describe('what happens at the counter', () => {
  it('records lines taken off, a cancelled basket, the drawer and the Z report, and sums them per person', async () => {
    const sale = await sell({});
    await sell({ paidBy: 'card' });
    const events = [
      { kind: 'line_removed', productId, quantity: 1, amount: 10, reason: 'Scanned twice' },
      { kind: 'line_removed', productId, quantity: 3, amount: 30, reason: 'Changed their mind' },
      { kind: 'basket_cancelled', quantity: 2, amount: 15.5, reason: 'Left without paying' },
      { kind: 'drawer_opened', reason: 'Change for a €50 note' },
      { kind: 'print_failed', documentId: sale.body.data.invoice.id, reason: 'Out of paper' },
      { kind: 'reprinted', documentId: sale.body.data.invoice.id },
      { kind: 'z_report' },
    ];
    expect((await api().post('/api/counter/events').set(auth(employeeToken)).send({ events })).status).toBe(201);
    // A line, basket or drawer always says why.
    expect((await api().post('/api/counter/events').set(auth(employeeToken)).send({ events: [{ kind: 'drawer_opened', reason: ' ' }] })).status).toBe(400);

    const people = await api().get(`/api/counter/people?${PERIOD}`).set(auth());
    expect(people.status).toBe(200);
    expect(people.body.data).toEqual([
      {
        user: { id: expect.any(Number), name: 'Test employee' },
        sales: 2,
        sold: 40,
        cash: 20,
        card: 20,
        tab: 0,
        linesRemoved: 2,
        removedAmount: 40,
        basketsCancelled: 1,
        cancelledAmount: 15.5,
        refunds: 0,
        refunded: 0,
        drawerOpens: 1,
        printFailures: 1,
        reprints: 1,
      },
    ]);
    expect((await api().get(`/api/counter/people?${PERIOD}`).set(auth(employeeToken))).status).toBe(403);

    const list = (await api().get(`/api/counter/events?${PERIOD}`).set(auth())).body.data;
    expect(list).toHaveLength(7);
    expect(list.find((event: { kind: string }) => event.kind === 'print_failed')).toMatchObject({ document: { number: sale.body.data.invoice.number }, reason: 'Out of paper' });

    const today = (await api().get('/api/counter/today').set(auth(employeeToken))).body.data;
    expect(today).toMatchObject({ lastZ: { by: 'Test employee' }, lastX: null });
    // The till shows the next receipt's number and the person's own day; cash counts everyone's.
    const year = day().slice(0, 4);
    expect(today).toMatchObject({ nextReceipt: `F-${year}-000003`, mine: { receipts: 2, total: 40, cash: 20, card: 20, tab: 0 }, cashToday: 20 });
    await sell({}, adminToken);
    expect((await api().get('/api/counter/today').set(auth(adminToken))).body.data).toMatchObject({
      nextReceipt: `F-${year}-000004`,
      mine: { receipts: 1, total: 20, cash: 20 },
      cashToday: 40,
    });

    const activity = (await api().get('/api/activity?page=1').set(auth())).body.data.map((entry: { summary: string }) => entry.summary);
    expect(activity).toEqual(expect.arrayContaining(['Opened the drawer without a sale: Change for a €50 note', "Ran the fiscal printer's Z report (closes the fiscal day)"]));
  });
});
