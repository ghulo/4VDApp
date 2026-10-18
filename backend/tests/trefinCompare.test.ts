import request from 'supertest';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { trefinVatMonth, type TrefinVatRows } from '../src/scripts/trefinVat.js';
import { compareItems } from '../src/services/vat/TrefinCompareService.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let accountantToken: string;
let employeeToken: string;
let productId: number;
let supplierId: number;

function monthKey(back: number): string {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - back);
  return date.toISOString().slice(0, 7);
}
const EARLIER = monthKey(2);
const LAST = monthKey(1);

const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);

/** TREFIN rows the way the export writes them: only the columns the reader looks at. */
const sale = (id: string, day: string, type = 'KUP', client = '700001') => ({ NrRen: id, NrFatura: `K-${id}`, Data: `${day} 00:00:00`, LlojDok: type, NrKlient: client, S_Vlera: '0', S_TVSH: '0', S_PaTVSH: '0', S_Ex: '0' });
const saleLine = (id: string, day: string, rate: string, net: number, vat: number) => ({ NrRen: id, Data: `${day} 00:00:00`, NR_TVSH: rate, Vlera: String(net), TVSH: String(vat), Totali: String(net + vat) });
const bill = (id: string, day: string, number: string, net: number, vat: number, extra: Record<string, string> = {}) => ({
  NrRen: id,
  NrFatura: number,
  Data: `${day} 00:00:00`,
  LlojDok: 'FBM',
  NrKlient: '700034',
  B_Vend_Vlera: String(net),
  B_Vend_TVSH: String(vat),
  Vlera: String(net),
  TVSH: String(vat),
  Totali: String(net + vat),
  ...extra,
});
const rows = (partial: Partial<TrefinVatRows>): TrefinVatRows => ({ sales: [], saleLines: [], bills: [], billLines: [], partners: [{ code: '700034', name: 'Fresh Foods', nui_unique_id: '811234567' }], ...partial });

describe("reading TREFIN's month", () => {
  it('puts till receipts on one line per day and splits sales by rate', () => {
    const items = trefinVatMonth(
      rows({
        sales: [sale('1', '2026-09-03'), sale('2', '2026-09-03'), sale('3', '2026-09-04'), sale('4', '2026-09-05', 'EKS', '700034'), sale('5', '2026-10-01')],
        saleLines: [saleLine('1', '2026-09-03', '5', 84.745762, 15.254238), saleLine('2', '2026-09-03', '4', 9.259259, 0.740741), saleLine('3', '2026-09-04', '3', 5, 0), saleLine('4', '2026-09-05', '5', 1890, 0), saleLine('5', '2026-10-01', '5', 10, 1.8)],
      }),
      '2026-09',
    );
    expect(items.map((item) => [item.kind, item.date, item.boxes, item.count ?? null])).toEqual([
      ['till_day', '2026-09-03', { 12: 84.75, 13: 15.25, 14: 9.26, 15: 0.74 }, 2],
      ['till_day', '2026-09-04', { 10: 5 }, 1],
      ['invoice', '2026-09-05', { 11: 1890 }, 1],
    ]);
    expect(items[2]).toMatchObject({ party: 'Fresh Foods', nui: '811234567', code: '700034' });
  });

  it('works out the rate of a bill without lines, and reads imports, equipment and returns', () => {
    const items = trefinVatMonth(
      rows({
        bills: [
          bill('10', '2026-09-02', 'S-1', 11.25, 0.9, { LlojDok: 'FBS' }),
          bill('11', '2026-09-03', 'IM-1', 0, 0, { LlojDok: 'IMM', B_Imp_Vlera: '500', B_Imp_TVSH: '90', B_Imp_PaTVSH: '40' }),
          bill('12', '2026-09-04', 'EQ-1', 0, 0, { LlojDok: 'FBI', B_Vend_I_Vlera: '1000', B_Vend_I_TVSH: '180' }),
          bill('13', '2026-09-05', 'KB-1', 20, 3.6, { LlojDok: 'KB' }),
          bill('14', '2026-09-06', 'G-1', 30, 4.2),
        ],
        // Goods with lines at two rates: the lines split the header.
        billLines: [saleLine('14', '2026-09-06', '5', 10, 1.8), saleLine('14', '2026-09-06', '4', 20, 1.6), saleLine('14', '2026-09-06', '4', 0, 0.8)],
      }),
      '2026-09',
    );
    expect(items.map((item) => [item.number, item.kind, item.boxes])).toEqual([
      ['S-1', 'bill', { 45: 11.25, 46: 0.9 }],
      ['IM-1', 'bill', { 35: 500, 36: 90, 31: 40 }],
      ['EQ-1', 'bill', { 47: 1000, 48: 180 }],
      ['KB-1', 'credit', { 16: 20, 17: 3.6 }],
      ['G-1', 'bill', { 43: 10, 44: 1.8, 45: 20, 46: 2.4 }],
    ]);
  });
});

describe('pairing documents', () => {
  const till = (date: string, boxes: Record<number, number>) => ({ kind: 'till_day' as const, ref: date, date, number: null, party: null, nui: null, boxes, count: 3 });
  it('calls cent differences rounding, a different split another rate, and the rest a different amount', () => {
    const rows = compareItems(
      [till('2026-09-01', { 12: 84.75, 13: 15.25 }), till('2026-09-02', { 12: 84.75, 13: 15.25 }), till('2026-09-03', { 12: 50, 13: 9 })],
      [
        { ...till('2026-09-01', { 12: 84.74, 13: 15.26 }), code: null },
        { ...till('2026-09-02', { 14: 92.59, 15: 7.41 }), code: null },
        { ...till('2026-09-03', { 12: 84.75, 13: 15.25 }), code: null },
      ],
    );
    expect(rows.map((row) => [row.date, row.status, row.reason])).toEqual([
      ['2026-09-01', 'rounding', null],
      ['2026-09-02', 'differs', 'rate'],
      ['2026-09-03', 'differs', 'amount'],
    ]);
    expect(rows[2]!.facts).toMatchObject({ gross: -41, vat: -6.25 });
  });
});

describe('the month side by side with TREFIN', () => {
  beforeAll(async () => {
    context = await setupTestApp();
  });
  beforeEach(async () => {
    await resetData(context.db);
    await seedBooks(context.db as never);
    adminToken = await loginAs(context, 'admin');
    accountantToken = await loginAs(context, 'accountant');
    employeeToken = await loginAs(context, 'employee');
    productId = await createTestProduct(context, adminToken, { price: 100, costPrice: 60, stock: 50, vatRate: 18 });
    supplierId = (await api().post('/api/suppliers').set(auth()).send({ name: 'Fresh Foods', nui: '811234567' })).body.data.id;
    await sql`update suppliers set external_code = '700034' where id = ${supplierId}`.execute(context.db);
    await api().put('/api/books/settings').set(auth()).send({ startDay: `${EARLIER}-01` });
  });
  afterAll(() => context?.db.destroy());

  const sell = async (day: string) => expect((await api().post('/api/sales').set(auth()).send({ productId, quantity: 1, saleDate: `${day}T10:00:00.000Z` })).status).toBe(201);
  const addBill = async (day: string, number: string) => expect((await api().post('/api/bills').set(auth()).send({ supplierId, number, issuedOn: day, amount: 118, vatAmount: 18 })).status).toBe(201);
  const view = async (token = accountantToken) => {
    const response = await api().get(`/api/vat/${LAST}/trefin`).set(auth(token));
    expect(response.status).toBe(200);
    return response.body.data;
  };

  it('pairs the documents, says why each differs, and keeps explanations', async () => {
    await sell(`${LAST}-05`);
    await sell(`${LAST}-07`);
    await addBill(`${LAST}-10`, `FF-${LAST}-10`);
    await addBill(`${EARLIER}-20`, 'FF-77');
    expect((await view()).loaded).toBeNull();

    const items = trefinVatMonth(
      rows({
        sales: [sale('1', `${LAST}-05`), sale('2', `${LAST}-06`)],
        saleLines: [saleLine('1', `${LAST}-05`, '5', 84.745763, 15.254237), saleLine('2', `${LAST}-06`, '5', 10, 1.8)],
        bills: [bill('10', `${LAST}-10`, `ff ${LAST}-10`, 100, 18), bill('11', `${LAST}-02`, 'FF-0077', 100, 18)],
      }),
      LAST,
    );
    await context.container.trefinCompareService.load(LAST, items, 'TREFIN-export', null);

    const data = await view();
    expect(data.loaded).toMatchObject({ source: 'TREFIN-export' });
    const byDate = Object.fromEntries(data.rows.map((row: { date: string; kind: string; status: string; reason: string | null; facts: object }) => [`${row.date} ${row.kind}`, [row.status, row.reason, row.facts]]));
    expect(byDate).toEqual({
      [`${LAST}-02 bill`]: ['differs', 'other_month', { month: EARLIER }],
      [`${LAST}-05 till_day`]: ['same', null, {}],
      [`${LAST}-06 till_day`]: ['differs', 'only_trefin', {}],
      [`${LAST}-07 till_day`]: ['differs', 'only_4vd', {}],
      [`${LAST}-10 bill`]: ['same', null, {}],
    });
    expect(data.totals.trefin).toEqual({ charged: 17.05, claimable: 36, toPay: 0 });
    expect(data.counts).toEqual({ same: 2, rounding: 0, differs: 3, explained: 0 });

    const key = data.rows.find((row: { reason: string | null }) => row.reason === 'only_trefin').key;
    expect((await api().post(`/api/vat/${LAST}/trefin/explain`).set(auth(accountantToken)).send({ key, note: 'ok' })).status).toBe(400);
    const explained = await api().post(`/api/vat/${LAST}/trefin/explain`).set(auth(accountantToken)).send({ key, note: 'A sale rung up only in TREFIN that day' });
    expect(explained.status).toBe(200);
    expect(explained.body.data.counts.explained).toBe(1);

    // A newer export keeps what was explained.
    await context.container.trefinCompareService.load(LAST, items, 'TREFIN-export-2', null);
    const again = await view();
    expect(again.rows.find((row: { key: string }) => row.key === key).explained).toMatchObject({ note: 'A sale rung up only in TREFIN that day' });
    expect((await api().post(`/api/vat/${LAST}/trefin/explain`).set(auth()).send({ key, note: null })).body.data.counts.explained).toBe(0);
    expect((await api().get('/api/vat/trefin').set(auth())).body.data).toEqual([LAST]);
  });

  it('is for the books people only', async () => {
    expect((await api().get(`/api/vat/${LAST}/trefin`).set(auth(employeeToken))).status).toBe(403);
    expect((await api().post(`/api/vat/${LAST}/trefin/explain`).set(auth(accountantToken)).send({ key: 'day:x', note: 'nothing loaded' })).status).toBe(404);
  });
});
