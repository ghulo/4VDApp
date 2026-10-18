import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { OpeningService } from '../src/services/OpeningService.js';
import { openBills, trefinOpening } from '../src/scripts/trefinOpening.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let accountantToken: string;
let employeeToken: string;
let supplierId: number;
let customerId: number;

const START = '2026-11-01';

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  await seedBooks(context.db as never);
  await sql`insert into settings (key, value) values ('books_start', to_jsonb(${START}::text))`.execute(context.db);
  adminToken = await loginAs(context, 'admin');
  accountantToken = await loginAs(context, 'accountant');
  employeeToken = await loginAs(context, 'employee');
  // 10 at €11.80 with 18% VAT: €100 of stock at cost without VAT.
  await createTestProduct(context, adminToken, { price: 20, costPrice: 11.8, stock: 10, vatRate: 18 });
  supplierId = (await api().post('/api/suppliers').set(auth()).send({ name: 'Viva Fresh Sh.p.k.', nui: '811234567' })).body.data.id;
  customerId = (await api().post('/api/customers').set(auth()).send({ name: 'Hotel Dukagjini', phone: '044 123 456' })).body.data.id;
  await sql`update suppliers set external_code = '700034' where id = ${supplierId}`.execute(context.db);
  await sql`update customers set external_code = '800001' where id = ${customerId}`.execute(context.db);
});
afterAll(() => context.db.destroy());

const api = () => request(context.app);
const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });

interface Line {
  id: number;
  kind: string;
  account: { number: string };
  place: { kind: string } | null;
  party: { name: string } | null;
  amount: number;
  trefinAmount: number | null;
  source: string;
  confirmed: boolean;
  editable: boolean;
  facts: { products?: number; noCost?: number; documents?: number };
}
interface View {
  lines: Line[];
  capital: { amount: number; account: { number: string } };
  debits: number;
  credits: number;
  blockers: string[];
  posted: { entryId: number } | null;
}

async function view(token = adminToken): Promise<View> {
  const response = await api().get('/api/books/opening').set(auth(token));
  expect(response.status).toBe(200);
  return response.body.data;
}
const line = (data: View, predicate: (line: Line) => boolean) => data.lines.find(predicate)!;
const shopTill = (data: View) => line(data, (candidate) => candidate.kind === 'place' && candidate.account.number === '1110');

async function confirmAll(): Promise<View> {
  const data = await view();
  const response = await api().post('/api/books/opening/confirm').set(auth()).send({ ids: data.lines.map((candidate) => candidate.id) });
  expect(response.status).toBe(200);
  return response.body.data;
}

/** A small TREFIN journal: till, VAT to claim, a supplier and a customer, a sale this year and one before. */
const JOURNAL = [
  { Data: '2026-03-01 00:00:00', NrLlog: '1110', Debi: '500', Kredi: '0', NrKlient: '0' },
  { Data: '2026-03-01 00:00:00', NrLlog: '4000', Debi: '0', Kredi: '500', NrKlient: '0' },
  { Data: '2025-05-01 00:00:00', NrLlog: '1110', Debi: '200', Kredi: '0', NrKlient: '0' },
  { Data: '2025-05-01 00:00:00', NrLlog: '4000', Debi: '0', Kredi: '200', NrKlient: '0' },
  { Data: '2026-10-01 00:00:00', NrLlog: '1260', Debi: '36', Kredi: '0', NrKlient: '0' },
  { Data: '2026-10-01 00:00:00', NrLlog: '1340', Debi: '200', Kredi: '0', NrKlient: '0' },
  { Data: '2026-10-01 00:00:00', NrLlog: '2000', Debi: '0', Kredi: '236', NrKlient: '700034' },
  { Data: '2026-10-20 00:00:00', NrLlog: '1230', Debi: '45', Kredi: '0', NrKlient: '800001' },
  { Data: '2026-10-20 00:00:00', NrLlog: '4000', Debi: '0', Kredi: '45', NrKlient: '0' },
  // On or after the start: not counted.
  { Data: '2026-11-01 00:00:00', NrLlog: '1110', Debi: '999', Kredi: '0', NrKlient: '0' },
];
const PURCHASES = [
  { source_db: 'M', doc_id: '1', document_number: '101', doc_type: 'FBM', purchase_date: '2026-09-01', supplier_code: '700034', line_total: '300' },
  { source_db: 'M', doc_id: '2', document_number: '102', doc_type: 'FBM', purchase_date: '2026-10-01', supplier_code: '700034', line_total: '150' },
  { source_db: 'M', doc_id: '2', document_number: '102', doc_type: 'FBM', purchase_date: '2026-10-01', supplier_code: '700034', line_total: '50' },
];

describe("TREFIN's balances", () => {
  it('works out the balances on the evening before the books start, by partner, with this year\'s profit apart', () => {
    const data = trefinOpening(JOURNAL, PURCHASES, START);
    expect(Object.fromEntries(data.accounts)).toEqual({ '1110': 700, '1260': 36, '1340': 200 });
    expect(data.profitThisYear).toBe(-545);
    expect(data.profitEarlier).toBe(-200);
    expect(Object.fromEntries(data.suppliers)).toEqual({ '700034': -236 });
    expect(Object.fromEntries(data.customers)).toEqual({ '800001': 45 });
    expect(data.off).toBe(0);
    expect(data.purchases.map((purchase) => [purchase.number, purchase.total])).toEqual([
      ['102', 200],
      ['101', 300],
    ]);
  });

  it('takes the newest invoices as the open ones, and an older balance when they run out', () => {
    const purchases = trefinOpening([], PURCHASES, START).purchases;
    expect(openBills(236, purchases)).toEqual({ bills: [expect.objectContaining({ number: '102', open: 200 }), expect.objectContaining({ number: '101', open: 36 })], rest: 0 });
    expect(openBills(600, purchases).rest).toBe(100);
  });
});

describe('opening balances', () => {
  it('starts with a line for each till, safe and bank account in the books and one for stock at cost', async () => {
    const data = await view();
    expect(data.lines.map((candidate) => [candidate.kind, candidate.account.number])).toEqual([
      ['place', '1110'],
      ['place', '1111'],
      ['place', '1120'],
      ['stock', '1340'],
    ]);
    expect(line(data, (candidate) => candidate.kind === 'stock')).toMatchObject({ amount: 100, source: 'stock', editable: false, facts: { products: 1, noCost: 0 } });
    expect(data.capital).toMatchObject({ amount: 100, account: { number: '3000' } });
    expect(data.blockers).toEqual(['unconfirmed']);
  });

  it('only posts once every line is confirmed, and a changed figure needs confirming again', async () => {
    let data = await confirmAll();
    expect(data.blockers).toEqual([]);
    const till = shopTill(data);
    data = (await api().patch(`/api/books/opening/lines/${till.id}`).set(auth()).send({ amount: 150, source: 'counted' })).body.data;
    expect(shopTill(data)).toMatchObject({ amount: 150, source: 'counted', confirmed: false });
    expect(data.blockers).toEqual(['unconfirmed']);
    const refused = await api().post('/api/books/opening/post').set(auth()).send({});
    expect(refused.status).toBe(400);
    expect(refused.body.message ?? refused.body.error?.message).toMatch(/1 line is not confirmed/);
  });

  it('posts one entry on the first day with the difference on capital, and the till starts from its count', async () => {
    let data = await view();
    await api().patch(`/api/books/opening/lines/${shopTill(data).id}`).set(auth()).send({ amount: 150, source: 'counted' });
    const vat = await api().get('/api/books/accounts').set(auth());
    const vatIn = vat.body.data.find((account: { number: string }) => account.number === '1260');
    const vatOwed = vat.body.data.find((account: { number: string }) => account.number === '2340');
    await api().post('/api/books/opening/lines').set(auth()).send({ accountId: vatIn.id, amount: 36 });
    await api().post('/api/books/opening/lines').set(auth()).send({ accountId: vatOwed.id, amount: 20 });
    await confirmAll();

    const posted = await api().post('/api/books/opening/post').set(auth(accountantToken)).send({});
    expect(posted.status).toBe(201);
    data = posted.body.data;
    expect(data.posted).not.toBeNull();
    expect(data.capital.amount).toBe(266);

    const entry = (await api().get(`/api/books/entries/${data.posted!.entryId}`).set(auth())).body.data;
    expect(entry.date).toBe(START);
    expect(entry.lines.map((entryLine: { accountNumber: string; debit: number; credit: number }) => `${entryLine.accountNumber} ${entryLine.debit || -entryLine.credit}`).sort()).toEqual([
      '1110 150',
      '1260 36',
      '1340 100',
      '2340 -20',
      '3000 -266',
    ]);
    const till = (await api().get('/api/money/places').set(auth())).body.data.find((place: { kind: string; carwashId: number | null }) => place.kind === 'till' && place.carwashId === null);
    expect(till).toMatchObject({ openingBalance: 150, openingDay: START });

    // Nothing changes once posted.
    const change = await api().patch(`/api/books/opening/lines/${shopTill(data).id}`).set(auth()).send({ amount: 1 });
    expect(change.status).toBe(409);
  });

  it('takes the opening back with a reason, cancelling the entry and putting the till back', async () => {
    await confirmAll();
    const { entryId } = (await api().post('/api/books/opening/post').set(auth()).send({})).body.data.posted;
    expect((await api().post('/api/books/opening/take-back').set(auth()).send({ reason: '' })).status).toBe(400);
    const back = await api().post('/api/books/opening/take-back').set(auth()).send({ reason: 'The till was counted wrong' });
    expect(back.status).toBe(200);
    expect(back.body.data.posted).toBeNull();
    const entry = (await api().get(`/api/books/entries/${entryId}`).set(auth())).body.data;
    expect(entry.reversed).toBe(true);
    const till = (await api().get('/api/money/places').set(auth())).body.data.find((place: { kind: string; carwashId: number | null }) => place.kind === 'till' && place.carwashId === null);
    expect(till.openingDay).toBeNull();
  });

  it('lets only people who write entries change it, and refuses income and cost accounts', async () => {
    const data = await view(accountantToken);
    expect((await api().get('/api/books/opening').set(auth(employeeToken))).status).toBe(403);
    expect((await api().patch(`/api/books/opening/lines/${shopTill(data).id}`).set(auth(employeeToken)).send({ amount: 5 })).status).toBe(403);
    const accounts = (await api().get('/api/books/accounts').set(auth())).body.data;
    const revenue = accounts.find((account: { number: string }) => account.number === '4000');
    const refused = await api().post('/api/books/opening/lines').set(auth()).send({ accountId: revenue.id, amount: 10 });
    expect(refused.status).toBe(400);
    const stock = line(data, (candidate) => candidate.kind === 'stock');
    expect((await api().patch(`/api/books/opening/lines/${stock.id}`).set(auth()).send({ amount: 5 })).status).toBe(400);
    expect((await api().delete(`/api/books/opening/lines/${stock.id}`).set(auth())).status).toBe(400);
  });
});

describe('bringing TREFIN over', () => {
  const load = () => new OpeningService(context.db, 'Europe/Budapest').loadTrefin(trefinOpening(JOURNAL, PURCHASES, START), null);

  it("fills TREFIN's figure beside each line and brings the open bills and customer balances over", async () => {
    const result = await load();
    expect(result).toMatchObject({ bills: 2, charges: 1 });
    const data = await view();
    expect(shopTill(data)).toMatchObject({ amount: 700, trefinAmount: 700, source: 'trefin' });
    expect(line(data, (candidate) => candidate.kind === 'stock')).toMatchObject({ amount: 100, trefinAmount: 200 });
    expect(line(data, (candidate) => candidate.kind === 'supplier')).toMatchObject({ amount: 236, trefinAmount: 236, editable: false, facts: { documents: 2 } });
    expect(line(data, (candidate) => candidate.kind === 'customer')).toMatchObject({ amount: 45, trefinAmount: 45, facts: { documents: 1 } });
    expect(line(data, (candidate) => candidate.account.number === '1260')).toMatchObject({ amount: 36, source: 'trefin' });
    expect(line(data, (candidate) => candidate.account.number === '3300')).toMatchObject({ amount: 545 });
    expect(line(data, (candidate) => candidate.account.number === '3400')).toMatchObject({ amount: 200 });

    const bills = await context.db.selectFrom('supplier_bills').select(['number', 'amount', 'brought_over', 'note']).orderBy('issued_on').execute();
    expect(bills.map((bill) => [bill.number, Number(bill.amount), bill.brought_over])).toEqual([
      ['101', 36, true],
      ['102', 200, true],
    ]);
    expect(bills[0]!.note).toMatch(/€36\.00 of €300\.00 was still open/);
  });

  it('can run again until posted, keeping what people typed', async () => {
    await load();
    let data = await view();
    await api().patch(`/api/books/opening/lines/${shopTill(data).id}`).set(auth()).send({ amount: 640, source: 'counted' });
    await load();
    data = await view();
    expect(shopTill(data)).toMatchObject({ amount: 640, source: 'counted', trefinAmount: 700 });
    expect(await context.db.selectFrom('supplier_bills').select('id').execute()).toHaveLength(2);
  });

  it('keeps brought-over bills out of the books, then posts what is owed per supplier; paying one posts as usual', async () => {
    await load();
    await confirmAll();
    const posted = (await api().post('/api/books/opening/post').set(auth()).send({})).body.data;
    expect(posted.posted).not.toBeNull();
    const entry = (await api().get(`/api/books/entries/${posted.posted.entryId}`).set(auth())).body.data;
    const payable = entry.lines.find((entryLine: { accountNumber: string }) => entryLine.accountNumber === '2000');
    expect(payable).toMatchObject({ credit: 236, party: { kind: 'supplier', name: 'Viva Fresh Sh.p.k.' } });

    const bill = await context.db.selectFrom('supplier_bills').select('id').where('number', '=', '102').executeTakeFirstOrThrow();
    const billEntries = (await api().get(`/api/books/entries?source=bill&id=${bill.id}`).set(auth())).body.data;
    expect(billEntries).toEqual([]);

    // Nor in the VAT purchase book of its month.
    const month = await api().get('/api/vat/2026-10').set(auth());
    expect(month.status).toBe(200);
    expect(JSON.stringify(month.body.data)).not.toContain('Viva Fresh');
  });
});
