import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import type { StatementLine } from '../src/services/money/statementFile.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let accountantToken: string;
let productId: number;
let supplierId: number;
let pdfLines: StatementLine[] = [];

beforeAll(async () => {
  context = await setupTestApp({ statementReader: { read: async () => pdfLines } });
});
beforeEach(async () => {
  await resetData(context.db);
  await seedBooks(context.db as never);
  adminToken = await loginAs(context, 'admin');
  accountantToken = await loginAs(context, 'accountant');
  productId = await createTestProduct(context, adminToken, { price: 100, costPrice: 60, stock: 50, vatRate: 18 });
  supplierId = (await api().post('/api/suppliers').set(auth()).send({ name: 'Viva Fresh Sh.p.k.', nui: '811234567' })).body.data.id;
});
afterAll(() => context.db.destroy());

const api = () => request(context.app);
const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const day = (offset = 0) => new Date(Date.now() + offset * MS_PER_DAY).toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });
/** "2026-10-13" as a Kosovo bank writes it: "13.10.2026". */
const kosovoDay = (iso: string) => iso.split('-').reverse().join('.');
const PERIOD = 'from=2000-01-01&to=2100-12-31';

interface Place {
  id: number;
  kind: 'till' | 'safe' | 'bank';
  name: string | null;
  carwashId: number | null;
  account: { number: string } | null;
  isDefault: boolean;
  inBooks: boolean;
  balance: number;
}

async function places(): Promise<Place[]> {
  const response = await api().get('/api/money/places').set(auth());
  expect(response.status).toBe(200);
  return response.body.data;
}

async function placeOf(predicate: (place: Place) => boolean): Promise<Place> {
  return (await places()).find(predicate)!;
}
const shopTill = () => placeOf((place) => place.kind === 'till' && place.carwashId === null);
const bank = () => placeOf((place) => place.kind === 'bank' && place.isDefault);

async function lines(source: string, id: number): Promise<string[]> {
  const response = await api().get(`/api/books/entries?source=${source}&id=${id}`).set(auth());
  expect(response.status).toBe(200);
  const live = response.body.data.filter((entry: { reversed: boolean; kind: string }) => !entry.reversed && entry.kind !== 'reversal');
  return live.flatMap((entry: { lines: Array<{ accountNumber: string; debit: number; credit: number }> }) =>
    entry.lines.map((line) => `${line.accountNumber} ${line.debit > 0 ? `Dr ${line.debit}` : `Cr ${line.credit}`}`).sort(),
  );
}

async function addBill(number: string, amount: number, issuedOn = day(-10)) {
  const response = await api().post('/api/bills').set(auth()).send({ supplierId, number, issuedOn, dueOn: day(10), amount });
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  return response.body.data.id as number;
}

const move = (body: Record<string, unknown>) => api().post('/api/money/moves').set(auth()).send({ day: day(), note: null, ...body });

describe('places money is kept', () => {
  it("has the shop's till, the carwash's till, a safe and a bank, each on its own account", async () => {
    const all = await places();
    expect(all.map((place) => [place.kind, place.account?.number, place.inBooks])).toEqual([
      ['till', '1110', true],
      ['till', '1112', false],
      ['safe', '1111', true],
      ['bank', '1120', true],
    ]);
  });

  it('adds a bank account under 1120 for an owner or manager; the accountant only reads', async () => {
    expect((await api().post('/api/money/places').set(auth()).send({ kind: 'bank', name: 'Raiffeisen', bankName: 'Raiffeisen', iban: 'XK05 1212 0123 4567 8907' })).status).toBe(400);
    const added = await api().post('/api/money/places').set(auth()).send({ kind: 'bank', name: 'Raiffeisen', bankName: 'Raiffeisen', iban: 'XK05 1212 0123 4567 8906' });
    expect(added.status).toBe(201);
    expect(added.body.data).toMatchObject({ kind: 'bank', name: 'Raiffeisen', iban: 'XK051212012345678906', account: { number: '1121', name: 'Banka – Raiffeisen' }, isDefault: false });
    expect((await api().get('/api/money/places').set(auth(accountantToken))).status).toBe(200);
    expect((await api().post('/api/money/places').set(auth(accountantToken)).send({ kind: 'safe', name: 'Box' })).status).toBe(403);
  });

  it("won't close a place with money in it", async () => {
    const till = await shopTill();
    const safe = await placeOf((place) => place.kind === 'safe');
    const added = (await api().post('/api/money/places').set(auth()).send({ kind: 'safe', name: 'Box' })).body.data;
    await move({ amount: 50, fromPlaceId: till.id, toPlaceId: added.id });
    expect((await api().patch(`/api/money/places/${added.id}`).set(auth()).send({ archived: true })).status).toBe(409);
    expect((await api().patch(`/api/money/places/${safe.id}`).set(auth()).send({ archived: true })).status).toBe(409);
  });
});

describe('moving money', () => {
  it('posts a move from the till to the bank, and shows it in both books with a running balance', async () => {
    expect((await api().post('/api/sales').set(auth()).send({ productId, quantity: 2 })).status).toBe(201);
    const till = await shopTill();
    const theBank = await bank();
    const moved = await move({ amount: 150, fromPlaceId: till.id, toPlaceId: theBank.id });
    expect(moved.status).toBe(201);
    expect(await lines('move', moved.body.data.id)).toEqual(['1110 Cr 150', '1120 Dr 150']);

    const book = (await api().get(`/api/money/places/${till.id}/book?${PERIOD}`).set(auth())).body.data;
    expect(book.lines.map((line: { kind: string; amount: number; balance: number }) => [line.kind, line.amount, line.balance])).toEqual([
      ['takings', 200, 200],
      ['move', -150, 50],
    ]);
    expect(book).toMatchObject({ opening: 0, moneyIn: 200, moneyOut: 150, closing: 50 });
    expect((await bank()).balance).toBe(150);

    const file = await api().get(`/api/money/places/${till.id}/book.xlsx?${PERIOD}&lang=sq&tz=Europe/Belgrade`).set(auth()).buffer(true);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('spreadsheetml');

    expect((await api().post(`/api/money/moves/${moved.body.data.id}/void`).set(auth())).status).toBe(200);
    expect(await lines('move', moved.body.data.id)).toEqual([]);
    expect((await shopTill()).balance).toBe(200);
  });

  it("posts the owner's money in and out against capital and drawings, and a carwash till's against the owner", async () => {
    const theBank = await bank();
    const carwashTill = await placeOf((place) => place.carwashId !== null);
    const putIn = await move({ amount: 1000, fromPlaceId: null, toPlaceId: theBank.id });
    expect(await lines('move', putIn.body.data.id)).toEqual(['1120 Dr 1000', '3000 Cr 1000']);
    const tookOut = await move({ amount: 200, fromPlaceId: theBank.id, toPlaceId: null });
    expect(await lines('move', tookOut.body.data.id)).toEqual(['1120 Cr 200', '3100 Dr 200']);
    const fromCarwash = await move({ amount: 80, fromPlaceId: carwashTill.id, toPlaceId: theBank.id });
    expect(await lines('move', fromCarwash.body.data.id)).toEqual(['1120 Dr 80', '3000 Cr 80']);
  });

  it('refuses a move in a filed month, the future, or to the same place', async () => {
    const till = await shopTill();
    const theBank = await bank();
    expect((await move({ amount: 10, fromPlaceId: till.id, toPlaceId: till.id })).status).toBe(400);
    expect((await move({ amount: 10, fromPlaceId: till.id, toPlaceId: theBank.id, day: day(3) })).status).toBe(400);
    const lastMonth = new Date();
    lastMonth.setUTCDate(1);
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    const month = lastMonth.toISOString().slice(0, 10);
    await context.db.insertInto('vat_months').values({ month, filed_at: new Date(), filed_by: null, figures: JSON.stringify({}), refund: 0 }).execute();
    const locked = await move({ amount: 10, fromPlaceId: till.id, toPlaceId: theBank.id, day: month });
    expect(locked.status).toBe(409);
  });

  it("takes a move into the till before the count off the count's expected cash", async () => {
    const till = await shopTill();
    const safe = await placeOf((place) => place.kind === 'safe');
    await api().post('/api/sales').set(auth()).send({ productId, quantity: 1 });
    await move({ amount: 40, fromPlaceId: safe.id, toPlaceId: till.id });
    // The drawer also holds its €50 float.
    const count = await api().post('/api/cash-counts').set(auth()).send({ counted: 190, place: 'shop' });
    expect(count.status).toBe(201);
    expect(count.body.data).toMatchObject({ expected: 140, difference: 0 });
  });
});

describe('paying several bills at once', () => {
  it('makes one payment from the chosen place over the ticked bills', async () => {
    const first = await addBill('2026/0457', 300, day(-20));
    const second = await addBill('2026/0460', 200, day(-5));
    const theBank = await bank();
    const paid = await api()
      .post('/api/money/pay-bills')
      .set(auth())
      .send({ supplierId, placeId: theBank.id, paidOn: day(), note: null, bills: [{ billId: first, amount: 300 }, { billId: second, amount: 50 }] });
    expect(paid.status).toBe(201);
    const bill = (await api().get(`/api/bills/${second}`).set(auth())).body.data;
    expect(bill).toMatchObject({ paid: 50, left: 150 });
    expect(bill.payments[0]).toMatchObject({ method: 'bank', place: { id: theBank.id, kind: 'bank' }, groupId: paid.body.data.groupId });
    const book = (await api().get(`/api/money/places/${theBank.id}/book?${PERIOD}`).set(auth())).body.data;
    expect(book.lines).toMatchObject([{ kind: 'group', amount: -350, bills: 2, party: { name: 'Viva Fresh Sh.p.k.' } }]);
    // Another supplier's bill can't ride along.
    const other = (await api().post('/api/suppliers').set(auth()).send({ name: 'Other', nui: '811234568' })).body.data.id;
    const theirs = (await api().post('/api/bills').set(auth()).send({ supplierId: other, number: 'X', issuedOn: day(-1), dueOn: null, amount: 10 })).body.data.id;
    expect((await api().post('/api/money/pay-bills').set(auth()).send({ supplierId, placeId: theBank.id, paidOn: day(), bills: [{ billId: theirs, amount: 10 }] })).status).toBe(400);
  });
});

describe('bank statements', () => {
  function statementCsv(rows: Array<[string, string, number]>, opening = 5000): string {
    let balance = opening;
    const body = rows.map(([iso, text, amount]) => {
      balance = Math.round((balance + amount) * 100) / 100;
      const money = (value: number) => value.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      return `"${kosovoDay(iso)}";"${text}";"${amount < 0 ? money(-amount) : ''}";"${amount > 0 ? money(amount) : ''}";"${money(balance)}"`;
    });
    return ['"Ekstrakt i llogarisë"', '"Data";"Përshkrimi";"Debi";"Kredi";"Bilanci"', ...body].join('\r\n');
  }

  const upload = async (placeId: number, csv: string, extra: Record<string, unknown> = {}) =>
    api()
      .post(`/api/money/places/${placeId}/statements`)
      .set(auth())
      .send({ fileName: 'ekstrakt.csv', data: Buffer.from(csv, 'utf8').toString('base64'), ...extra });

  const openLines = async (placeId: number) => (await api().get(`/api/money/places/${placeId}/lines?status=open`).set(auth())).body.data;

  it('reads a statement, suggests matches with reasons, and confirms the sure ones in one go', async () => {
    const theBank = await bank();
    const till = await shopTill();
    const bill = await addBill('2026/0457', 845.6);
    await move({ amount: 1200, fromPlaceId: till.id, toPlaceId: theBank.id, day: day(-3) });
    const csv = statementCsv([
      [day(-2), 'Depozite ne para te gatshme', 1200],
      [day(-1), 'Pagese fatura 2026/0457 Viva Fresh', -845.6],
      [day(-1), 'Provizion mujor', -4.5],
      [day(0), 'Qira tetor', -650],
    ]);
    const uploaded = await upload(theBank.id, csv);
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data).toMatchObject({ needsLayout: false, added: 4, skipped: 0, statement: { closingBalance: 4699.9, linesRead: 4 } });

    const open = await openLines(theBank.id);
    const byText = (text: string) => open.find((line: { text: string }) => line.text.startsWith(text));
    expect(byText('Pagese fatura').suggestions[0]).toMatchObject({ sure: true, action: { kind: 'payBills', bills: [{ billId: bill, amount: 845.6 }] } });
    expect(byText('Depozite').suggestions[0]).toMatchObject({ sure: true, action: { kind: 'linkMove' } });
    expect(byText('Provizion').suggestions).toEqual([]);

    // The fee becomes an expense, and a rule takes the next one.
    const fee = byText('Provizion');
    const confirmed = await api().post(`/api/money/lines/${fee.id}/confirm`).set(auth()).send({ action: { kind: 'expense', category: 'bank_fees', supplierId: null }, rule: { contains: 'Provizion' } });
    expect(confirmed.status).toBe(200);
    const rules = (await api().get('/api/money/rules').set(auth())).body.data;
    expect(rules).toMatchObject([{ contains: 'Provizion', direction: 'out', action: 'expense', category: 'bank_fees' }]);

    const sure = await api().post(`/api/money/places/${theBank.id}/confirm-sure`).set(auth());
    expect(sure.body.data).toEqual({ confirmed: 2, failed: 0 });
    expect((await api().get(`/api/bills/${bill}`).set(auth())).body.data).toMatchObject({ left: 0, status: 'paid' });
    expect((await openLines(theBank.id)).map((line: { text: string }) => line.text)).toEqual(['Qira tetor']);

    // The rent becomes an expense too; then 4VD's balance is the bank's, less nothing.
    const rent = (await openLines(theBank.id))[0];
    await api().post(`/api/money/lines/${rent.id}/confirm`).set(auth()).send({ action: { kind: 'expense', category: 'rent', supplierId: null } });
    const [statement] = (await api().get(`/api/money/places/${theBank.id}/statements`).set(auth())).body.data;
    // 4VD didn't know the account's €5,000 opening balance: that is the difference left.
    expect(statement).toMatchObject({ closingBalance: 4699.9, ourBalance: -300.1, difference: 5000 });

    // A statement overlapping this one only brings in the new lines; the rule matches the new fee.
    const again = await upload(theBank.id, `${csv}\r\n"${kosovoDay(day(0))}";"Provizion transferi";"1,00";"";"4.698,90"`);
    expect(again.body.data).toMatchObject({ added: 1, skipped: 4 });
    const [newFee] = await openLines(theBank.id);
    expect(newFee.suggestions[0]).toMatchObject({ sure: true, ruleId: rules[0].id, reasons: [{ key: 'rule', contains: 'Provizion' }] });
  });

  it('takes a match back: a payment it made is removed, one it only found stays', async () => {
    const theBank = await bank();
    const bill = await addBill('2026/0500', 120);
    await upload(theBank.id, statementCsv([[day(-1), 'Viva Fresh', -120]]));
    const [line] = await openLines(theBank.id);
    await api().post(`/api/money/lines/${line.id}/confirm`).set(auth()).send({ action: line.suggestions[0].action });
    const payment = (await api().get(`/api/bills/${bill}`).set(auth())).body.data.payments[0];
    // The payment can't be removed on its own while the statement holds it.
    expect((await api().post(`/api/bills/${bill}/payments/${payment.id}/void`).set(auth())).status).toBe(409);
    expect((await api().post(`/api/money/lines/${line.id}/undo`).set(auth())).status).toBe(200);
    expect((await api().get(`/api/bills/${bill}`).set(auth())).body.data).toMatchObject({ left: 120 });

    // Paid by hand first, the line only finds it, and taking the match back leaves it.
    await api().post(`/api/bills/${bill}/payments`).set(auth()).send({ amount: 120, paidOn: day(-2), placeId: theBank.id, note: null });
    const [again] = await openLines(theBank.id);
    expect(again.suggestions[0]).toMatchObject({ sure: true, action: { kind: 'linkPayment' } });
    await api().post(`/api/money/lines/${again.id}/confirm`).set(auth()).send({ action: again.suggestions[0].action });
    await api().post(`/api/money/lines/${again.id}/undo`).set(auth());
    expect((await api().get(`/api/bills/${bill}`).set(auth())).body.data).toMatchObject({ left: 0 });
  });

  it("receives a customer's payment into the bank against their invoice", async () => {
    const theBank = await bank();
    const customer = (await api().post('/api/customers').set(auth()).send({ name: 'Dardania Trade', phone: '044 123 456' })).body.data.id;
    await api().post('/api/sales').set(auth()).send({ productId, quantity: 2, customerId: customer });
    await upload(theBank.id, statementCsv([[day(0), 'Pagese nga Dardania Trade', 200]]));
    const [line] = await openLines(theBank.id);
    expect(line.suggestions[0]).toMatchObject({ sure: true, action: { kind: 'receive', customerId: customer } });
    await api().post(`/api/money/lines/${line.id}/confirm`).set(auth()).send({ action: line.suggestions[0].action });
    expect((await api().get(`/api/customers/${customer}`).set(auth())).body.data).toMatchObject({ balance: 0 });
    // Money into the bank is not in the shop's till.
    expect((await shopTill()).balance).toBe(0);
    expect((await bank()).balance).toBe(200);
  });

  it('asks which column is which when the headers say nothing, then remembers', async () => {
    const theBank = await bank();
    const csv = `K1;K2;K3\n${kosovoDay(day(-1))};Something;-12,00\n`;
    const asked = await upload(theBank.id, csv);
    expect(asked.status).toBe(200);
    expect(asked.body.data).toMatchObject({ needsLayout: true, preview: [['K1', 'K2', 'K3'], [kosovoDay(day(-1)), 'Something', '-12,00']] });
    const layout = { headerRow: 0, date: 0, text: 1, party: null, moneyIn: null, moneyOut: null, amount: 2, balance: null, headers: ['K1', 'K2', 'K3'] };
    expect((await upload(theBank.id, csv, { layout })).status).toBe(201);
    const next = await upload(theBank.id, `K1;K2;K3\n${kosovoDay(day(0))};Other;-3,00\n`);
    expect(next.body.data).toMatchObject({ needsLayout: false, added: 1 });
  });

  it('reads a PDF statement with the AI reader, and refuses old .xls files', async () => {
    const theBank = await bank();
    pdfLines = [{ day: day(-1), text: 'Provizion', amount: -2, balance: 98 }];
    const response = await api().post(`/api/money/places/${theBank.id}/statements`).set(auth()).send({ fileName: 'ekstrakt.pdf', data: Buffer.from('%PDF-1.4').toString('base64') });
    expect(response.status).toBe(201);
    expect(response.body.data.statement).toMatchObject({ format: 'pdf', openingBalance: 100, closingBalance: 98 });
    const old = await api().post(`/api/money/places/${theBank.id}/statements`).set(auth()).send({ fileName: 'ekstrakt.xls', data: 'AAAA' });
    expect(old.status).toBe(400);
  });
});
