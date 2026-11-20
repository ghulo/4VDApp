import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

/**
 * A refund goes back the way it really went: cash out of the till, on the
 * card terminal (the bank), by bank transfer (owed to the customer until it
 * is sent) or off their tab.
 */

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

interface Basket {
  invoiceId: number;
  number: string;
  saleIds: number[];
}

async function sell(body: Record<string, unknown>, token = employeeToken, quantity = 2): Promise<Basket> {
  const response = await api()
    .post('/api/sales/basket')
    .set(auth(token))
    .send({ items: [{ productId, quantity }], notes: null, ...body });
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  const data = response.body.data;
  return { invoiceId: data.invoice.id, number: data.invoice.number, saleIds: data.sales.map((sale: { id: number }) => sale.id) };
}

const giveBack = (saleId: number, body: Record<string, unknown>, token = adminToken) =>
  api().post(`/api/sales/${saleId}/returns`).set(auth(token)).send({ condition: 'resellable', notes: null, ...body });

async function returnLines(returnId: number): Promise<string[]> {
  const response = await api().get(`/api/books/entries?source=return&id=${returnId}`).set(auth());
  expect(response.status).toBe(200);
  return response.body.data
    .filter((entry: { reversed: boolean; kind: string }) => !entry.reversed && entry.kind !== 'reversal')
    .flatMap((entry: { lines: Array<{ accountNumber: string; debit: number; credit: number }> }) =>
      entry.lines.map((line) => `${line.accountNumber} ${line.debit > 0 ? `Dr ${line.debit}` : `Cr ${line.credit}`}`),
    )
    .sort();
}

async function places() {
  const list = (await api().get('/api/money/places').set(auth())).body.data as Array<{ id: number; kind: string; carwashId: number | null; isDefault: boolean }>;
  return {
    till: list.find((place) => place.kind === 'till' && place.carwashId === null)!,
    bank: list.find((place) => place.kind === 'bank' && place.isDefault)!,
  };
}

const book = async (id: number) =>
  (await api().get(`/api/money/places/${id}/book?${PERIOD}`).set(auth())).body.data.lines.map((line: { kind: string; amount: number }) => [line.kind, line.amount]);

/** What the drawer should hold now beyond the float, from a blind count of the float plus `extra`. */
async function drawerExpected(): Promise<number> {
  const count = await api().post('/api/cash-counts').set(auth()).send({ counted: 50, place: 'shop' });
  expect(count.status).toBe(201);
  return count.body.data.expected;
}

describe('a refund with no say on how the money goes back', () => {
  it('still comes out of the till, as before', async () => {
    const card = await sell({ paidBy: 'card' });
    const response = await giveBack(card.saleIds[0]!, { quantity: 1 });
    expect(response.status).toBe(201);
    expect(response.body.data.refundBy).toMatchObject({ cash: 10, card: 0, transfer: 0 });
    expect(await returnLines(response.body.data.id)).toEqual(expect.arrayContaining(['1110 Cr 10']));
  });
});

describe('a refund on the card terminal', () => {
  it('comes off the card money in the bank, not the drawer', async () => {
    const card = await sell({ paidBy: 'card' });
    await sell({});

    const response = await giveBack(card.saleIds[0]!, { quantity: 1, refundBy: { card: 10, approvalCode: '123456' } });
    expect(response.status).toBe(201);
    expect(response.body.data.refundBy).toMatchObject({ cash: 0, card: 10, approvalCode: '123456' });
    const lines = await returnLines(response.body.data.id);
    expect(lines).toEqual(expect.arrayContaining(['1120 Cr 10']));
    expect(lines.some((line) => line.startsWith('1110'))).toBe(false);

    const { till, bank } = await places();
    expect(await book(till.id)).toEqual([['takings', 20]]);
    expect(await book(bank.id)).toEqual([['card', 10]]);
    expect(await drawerExpected()).toBe(20);
  });
});

describe('a refund in cash', () => {
  it('comes out of the drawer', async () => {
    await sell({});
    const second = await sell({});
    const response = await giveBack(second.saleIds[0]!, { quantity: 1, refundBy: { card: 0 } });
    expect(response.status).toBe(201);
    expect(await returnLines(response.body.data.id)).toEqual(expect.arrayContaining(['1110 Cr 10']));
    const { till } = await places();
    expect(await book(till.id)).toEqual([['takings', 30]]);
    expect(await drawerExpected()).toBe(30);
  });
});

describe('a refund by bank transfer', () => {
  it('needs the customer’s name and a real IBAN when one is given', async () => {
    const sale = await sell({});
    expect((await giveBack(sale.saleIds[0]!, { quantity: 1, refundBy: { transfer: 10 } })).status).toBe(400);
    expect((await giveBack(sale.saleIds[0]!, { quantity: 1, refundBy: { transfer: 10, customerName: 'Arben K.', iban: 'XK00 1234' } })).status).toBe(400);
  });

  it('is owed to the customer until it is sent, then comes from the bank', async () => {
    const sale = await sell({});
    const batch = randomUUID();
    const response = await giveBack(sale.saleIds[0]!, { quantity: 2, refundBy: { transfer: 20, customerName: 'Arben K.', iban: 'XK051212012345678906', batch } });
    expect(response.status).toBe(201);
    const returnId = response.body.data.id as number;
    expect(await returnLines(returnId)).toEqual(expect.arrayContaining(['2430 Cr 20']));

    // The drawer kept the sale's cash: nothing went out of it.
    const { till, bank } = await places();
    expect(await book(till.id)).toEqual([['takings', 20]]);
    expect(await drawerExpected()).toBe(20);

    const owed = await api().get('/api/money/refunds-to-pay').set(auth());
    expect(owed.status).toBe(200);
    expect(owed.body.data).toEqual([
      expect.objectContaining({ customerName: 'Arben K.', iban: 'XK051212012345678906', amount: 20, returnIds: [returnId], receiptNumber: sale.number }),
    ]);

    // Staff can't mark it sent; a manager can, once.
    expect((await api().post('/api/money/refunds-to-pay/sent').set(auth(employeeToken)).send({ returnIds: [returnId], placeId: bank.id, day: day() })).status).toBe(403);
    const sent = await api().post('/api/money/refunds-to-pay/sent').set(auth()).send({ returnIds: [returnId], placeId: bank.id, day: day() });
    expect(sent.status).toBe(200);
    expect((await api().post('/api/money/refunds-to-pay/sent').set(auth()).send({ returnIds: [returnId], placeId: bank.id, day: day() })).status).toBe(409);

    expect((await api().get('/api/money/refunds-to-pay').set(auth())).body.data).toEqual([]);
    expect(await returnLines(returnId)).toEqual(expect.arrayContaining(['2430 Cr 20', '2430 Dr 20', '1120 Cr 20']));
    expect(await book(bank.id)).toEqual([['refund', -20]]);

    // Once the money has gone, the return can't simply be undone.
    const logged = await context.db.selectFrom('activity_log').select('id').where('action', '=', 'return.requested').orderBy('id', 'desc').executeTakeFirstOrThrow();
    const undo = await api().post(`/api/activity/${logged.id}/undo`).set(auth()).send({});
    expect(undo.status).toBe(409);
  });

  it('shows the lines of one refund as one payment to make', async () => {
    const other = await createTestProduct(context, adminToken, { price: 5, costPrice: 2, stock: 10, vatRate: 18 });
    const response = await api()
      .post('/api/sales/basket')
      .set(auth(employeeToken))
      .send({ items: [{ productId, quantity: 1 }, { productId: other, quantity: 2 }], notes: null });
    const saleIds = response.body.data.sales.map((sale: { id: number }) => sale.id) as number[];
    const batch = randomUUID();
    const first = await giveBack(saleIds[0]!, { quantity: 1, refundBy: { transfer: 10, customerName: 'Arben K.', batch } });
    const second = await giveBack(saleIds[1]!, { quantity: 2, refundBy: { transfer: 10, customerName: 'Arben K.', batch } });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const owed = (await api().get('/api/money/refunds-to-pay').set(auth())).body.data;
    expect(owed).toHaveLength(1);
    expect(owed[0]).toMatchObject({ amount: 20, iban: null });
    expect([...owed[0].returnIds].sort()).toEqual([first.body.data.id, second.body.data.id].sort());
  });
});

describe('a refund split the way the sale was paid', () => {
  it('sends the card part to the bank and the rest out of the drawer', async () => {
    const split = await sell({ cardAmount: 12.5 });
    const response = await giveBack(split.saleIds[0]!, { quantity: 2, refundBy: { card: 12.5 } });
    expect(response.status).toBe(201);
    expect(response.body.data.refundBy).toMatchObject({ cash: 7.5, card: 12.5 });
    expect(await returnLines(response.body.data.id)).toEqual(expect.arrayContaining(['1110 Cr 7.5', '1120 Cr 12.5']));
    const { till, bank } = await places();
    expect(await book(till.id)).toEqual([]);
    expect(await book(bank.id)).toEqual([]);
  });

  it('refuses parts that come to more than the refund, or a tab part on a sale not on a tab', async () => {
    const split = await sell({ cardAmount: 12.5 });
    expect((await giveBack(split.saleIds[0]!, { quantity: 1, refundBy: { card: 8, transfer: 5, customerName: 'A' } })).status).toBe(400);
    expect((await giveBack(split.saleIds[0]!, { quantity: 1, refundBy: { tab: 5 } })).status).toBe(400);
  });
});

describe('a refund that waits for the owner', () => {
  it('keeps the way chosen and books it when approved', async () => {
    const card = await sell({ paidBy: 'card' }, employeeToken, 8);
    const response = await giveBack(card.saleIds[0]!, { quantity: 8, refundBy: { card: 80 } }, employeeToken);
    expect(response.body.data).toMatchObject({ status: 'pending', refundBy: { card: 80, cash: 0 } });
    const approved = await api().post(`/api/returns/${response.body.data.id}/approve`).set(auth()).send({});
    expect(approved.status).toBe(200);
    expect(await returnLines(response.body.data.id)).toEqual(expect.arrayContaining(['1120 Cr 80']));
  });
});

describe('what the refund screen is told about the sale', () => {
  it('gives the receipt, how it was paid and whether the owner must approve', async () => {
    const split = await sell({ cardAmount: 12.5 });
    const info = await api().get(`/api/returns/refund-info?saleId=${split.saleIds[0]}`).set(auth(employeeToken));
    expect(info.status).toBe(200);
    expect(info.body.data).toMatchObject({
      receiptNumber: split.number,
      paidBy: 'split',
      cardAmount: 12.5,
      receiptTotal: 20,
      tabCustomer: null,
      approval: { limit: 50, tooOld: false },
    });
    expect(typeof info.body.data.soldAt).toBe('string');
    const mine = await api().get(`/api/returns/refund-info?saleId=${split.saleIds[0]}`).set(auth());
    expect(mine.body.data.approval).toBeNull();
  });
});
