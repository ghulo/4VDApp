import { sql } from 'kysely';
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
  // €100 with 18% VAT inside: €84.75 revenue and €15.25 VAT. Costs €60.
  productId = await createTestProduct(context, adminToken, { price: 100, costPrice: 60, stock: 50, vatRate: 18 });
});
afterAll(() => context.db.destroy());

const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);
const today = () => new Date().toISOString().slice(0, 10);
const PERIOD = 'from=2000-01-01&to=2100-12-31';

interface Line {
  accountNumber: string;
  debit: number;
  credit: number;
  party: { kind: string; name: string } | null;
}
interface Entry {
  id: number;
  kind: string;
  source: string | null;
  reversed: boolean;
  warning: string | null;
  lines: Line[];
}

/** An entry's lines as "1110 Dr 100" strings, easy to compare. */
const readLines = (entry: Entry) => entry.lines.map((line) => `${line.accountNumber} ${line.debit > 0 ? `Dr ${line.debit}` : `Cr ${line.credit}`}`).sort();

async function entriesFor(source: string, id: number): Promise<Entry[]> {
  const response = await api().get(`/api/books/entries?source=${source}&id=${id}`).set(auth());
  expect(response.status).toBe(200);
  return response.body.data;
}

async function balances(): Promise<Record<string, number>> {
  const response = await api().get(`/api/books/trial-balance?${PERIOD}`).set(auth());
  expect(response.status).toBe(200);
  return Object.fromEntries(response.body.data.rows.map((row: { number: string; closing: number }) => [row.number, row.closing]));
}

async function sell(quantity = 1, body: Record<string, unknown> = {}): Promise<number> {
  const response = await api().post('/api/sales').set(auth()).send({ productId, quantity, ...body });
  expect(response.status).toBe(201);
  return response.body.data.id;
}

async function supplier(): Promise<number> {
  const response = await api().post('/api/suppliers').set(auth()).send({ name: 'Fresh Foods', nui: '811234567' });
  return response.body.data.id;
}

describe('the chart of accounts', () => {
  it("starts with TREFIN's 144 accounts and 4VD's profit tax account, each kind of movement linked to its account", async () => {
    const response = await api().get('/api/books/accounts').set(auth());
    expect(response.status).toBe(200);
    // TREFIN's 144, 4VD's 8900 for the profit tax, and a sub-account each for the safe and the carwash's till (the shop's till and the bank use 1110 and 1120).
    expect(response.body.data).toHaveLength(147);
    expect(response.body.data.filter((account: { number: string }) => ['1111', '1112'].includes(account.number))).toHaveLength(2);
    const stock = response.body.data.find((account: { number: string }) => account.number === '1340');
    expect(stock).toMatchObject({ name: 'Stoqet e produkteve të gatshme', accountClass: 'asset', links: ['stock'] });
  });

  it('adds an account, refuses a number that is taken, and keeps the number of a used account', async () => {
    const added = await api()
      .post('/api/books/accounts')
      .set(auth())
      .send({ number: '6245', name: 'Qese plastike', accountClass: 'expense', type: 'Shpenzimet Operative', group: 'Shpenzimet operative' });
    expect(added.status).toBe(201);
    const taken = await api()
      .post('/api/books/accounts')
      .set(auth())
      .send({ number: '6245', name: 'Again', accountClass: 'expense', type: 'Shpenzimet Operative', group: 'Shpenzimet operative' });
    expect(taken.status).toBe(400);
    expect(taken.body.message).toContain('already exists');

    await sell();
    const cash = (await api().get('/api/books/accounts').set(auth())).body.data.find((account: { number: string }) => account.number === '1110');
    const renumber = await api().patch(`/api/books/accounts/${cash.id}`).set(auth()).send({ number: '1111' });
    expect(renumber.status).toBe(400);
    expect(renumber.body.message).toContain('already has entries');
    const archive = await api().patch(`/api/books/accounts/${cash.id}`).set(auth()).send({ archived: true });
    expect(archive.status).toBe(400);
  });

  it('lets only managers change the books, and only overseers read them', async () => {
    expect((await api().get('/api/books/accounts').set(auth(employeeToken))).status).toBe(403);
    expect((await api().post('/api/books/entries').set(auth(employeeToken)).send({})).status).toBe(403);
  });
});

describe('entries written from documents', () => {
  it('posts a sale: cash against revenue and VAT, and its cost out of stock', async () => {
    const saleId = await sell(1);
    const [entry] = await entriesFor('sale', saleId);
    expect(entry!.kind).toBe('auto');
    expect(readLines(entry!)).toEqual(['1110 Dr 100', '1340 Cr 60', '2340 Cr 15.25', '4000 Cr 84.75', '5000 Dr 60'].sort());
  });

  it("posts a sale on a customer's tab to their receivable, and their payment back to cash", async () => {
    const customer = (await api().post('/api/customers').set(auth()).send({ name: 'Arben' })).body.data.id;
    const saleId = await sell(2, { customerId: customer });
    const [entry] = await entriesFor('sale', saleId);
    expect(readLines(entry!)).toContain('1230 Dr 200');
    expect(entry!.lines.find((line) => line.accountNumber === '1230')!.party).toMatchObject({ kind: 'customer', name: 'Arben' });

    await api().post(`/api/customers/${customer}/payments`).set(auth()).send({ amount: 50 });
    const totals = await balances();
    expect(totals['1230']).toBe(150);
    expect(totals['1110']).toBe(50);
  });

  it('reverses the entry when a sale is undone, and hides the pair unless asked', async () => {
    const saleId = await sell(1);
    expect(await entriesFor('sale', saleId)).toHaveLength(1);
    const activity = await context.db.selectFrom('activity_log').select('id').where('action', '=', 'sale.recorded').executeTakeFirstOrThrow();
    expect((await api().post(`/api/activity/${activity.id}/undo`).set(auth()).send({ note: 'wrong item' })).status).toBe(200);

    const entries = await entriesFor('sale', saleId);
    expect(entries.map((entry) => entry.kind)).toEqual(['auto', 'reversal']);
    expect(entries[0]!.reversed).toBe(true);
    const totals = await balances();
    expect(totals['1110'] ?? 0).toBe(0);
    expect(totals['4000'] ?? 0).toBe(0);

    const plain = await api().get(`/api/books/journal?${PERIOD}`).set(auth());
    expect(plain.body.data).toHaveLength(0);
    const withCorrections = await api().get(`/api/books/journal?${PERIOD}&corrections=true`).set(auth());
    expect(withCorrections.body.data).toHaveLength(2);
  });

  it('posts an approved return: sales returns and VAT against the cash paid back, cost back into stock', async () => {
    const saleId = await sell(2);
    const returned = await api().post(`/api/sales/${saleId}/returns`).set(auth()).send({ quantity: 1, condition: 'resellable' });
    expect(returned.status).toBe(201);
    const [entry] = await entriesFor('return', returned.body.data.id);
    expect(readLines(entry!)).toEqual(['1110 Cr 100', '1340 Dr 60', '2340 Dr 15.25', '4200 Dr 84.75', '5000 Cr 60'].sort());
  });

  it("posts a supplier's bill with its VAT, its payment, and reverses a payment taken back", async () => {
    const supplierId = await supplier();
    const bill = await api().post('/api/bills').set(auth()).send({ supplierId, number: 'FF-1', issuedOn: today(), amount: 118, vatAmount: 18 });
    expect(bill.status).toBe(201);
    const paid = await api().post(`/api/bills/${bill.body.data.id}/payments`).set(auth()).send({ amount: 118, paidOn: today(), method: 'bank' });
    expect(paid.status).toBe(201);

    const [billEntry, paymentEntry] = await entriesFor('bill', bill.body.data.id);
    expect(readLines(billEntry!)).toEqual(['1260 Dr 18', '1340 Dr 100', '2000 Cr 118'].sort());
    expect(billEntry!.lines.find((line) => line.accountNumber === '2000')!.party).toMatchObject({ kind: 'supplier', name: 'Fresh Foods' });
    expect(readLines(paymentEntry!)).toEqual(['1120 Cr 118', '2000 Dr 118']);

    const paymentId = paid.body.data.payments[0].id;
    expect((await api().post(`/api/bills/${bill.body.data.id}/payments/${paymentId}/void`).set(auth()).send({})).status).toBe(200);
    const totals = await balances();
    expect(totals['2000']).toBe(-118);
    expect(totals['1120'] ?? 0).toBe(0);
  });

  it('warns when a bill has no VAT entered, instead of guessing it', async () => {
    const supplierId = await supplier();
    const bill = await api().post('/api/bills').set(auth()).send({ supplierId, issuedOn: today(), amount: 50 });
    const [entry] = await entriesFor('bill', bill.body.data.id);
    expect(entry!.warning).toBe('no_vat');
    expect(readLines(entry!)).toEqual(['1340 Dr 50', '2000 Cr 50']);
  });

  it("posts a shop expense to its category's account and reverses it when removed; carwash-only ones stay out", async () => {
    const rent = await api().post('/api/expenses').set(auth()).send({ day: today(), amount: 300, category: 'rent', place: 'shop' });
    expect(rent.status).toBe(201);
    const carwashId = (await context.db.selectFrom('carwashes').select('id').executeTakeFirstOrThrow()).id;
    await api().post('/api/expenses').set(auth()).send({ day: today(), amount: 40, category: 'water', place: 'carwash', carwashId });
    expect((await balances())['6650']).toBe(300);
    expect((await balances())['6830']).toBeUndefined();

    // An expense is a bill paid on the spot: the cost against the supplier account, and its payment from the safe (cash not from the till).
    const [costEntry, paymentEntry] = await entriesFor('expense', rent.body.data.id);
    expect(readLines(costEntry!)).toEqual(['2000 Cr 300', '6650 Dr 300']);
    expect(readLines(paymentEntry!)).toEqual(['1111 Cr 300', '2000 Dr 300']);

    await api().delete(`/api/expenses/${rent.body.data.id}`).set(auth());
    const entries = await entriesFor('expense', rent.body.data.id);
    expect(entries.map((entry) => entry.kind).sort()).toEqual(['auto', 'auto', 'reversal', 'reversal']);
    expect((await balances())['6650'] ?? 0).toBe(0);
  });

  it('posts an approved write-off at cost against stock corrections', async () => {
    const writeOff = await api().post('/api/write-offs').set(auth()).send({ productId, quantity: 2, reason: 'damaged' });
    expect(writeOff.status).toBe(201);
    const [entry] = await entriesFor('write_off', writeOff.body.data.id);
    expect(readLines(entry!)).toEqual(['1340 Cr 120', '5400 Dr 120']);
  });

  it('keeps the trial balance balanced', async () => {
    await sell(3);
    const supplierId = await supplier();
    await api().post('/api/bills').set(auth()).send({ supplierId, issuedOn: today(), amount: 236, vatAmount: 36 });
    const response = await api().get(`/api/books/trial-balance?${PERIOD}`).set(auth());
    const rows: Array<{ debit: number; credit: number; closing: number }> = response.body.data.rows;
    const sum = (pick: (row: (typeof rows)[number]) => number) => Math.round(rows.reduce((total, row) => total + pick(row), 0) * 100) / 100;
    expect(sum((row) => row.debit)).toBe(sum((row) => row.credit));
    expect(sum((row) => row.closing)).toBe(0);
  });
});

describe('entries written by hand', () => {
  async function accountId(number: string): Promise<number> {
    return (await context.db.selectFrom('ledger_accounts').select('id').where('number', '=', number).executeTakeFirstOrThrow()).id;
  }

  it('refuses an entry that does not balance and says by how much', async () => {
    const response = await api()
      .post('/api/books/entries')
      .set(auth())
      .send({
        date: today(),
        description: 'Owner put money in',
        lines: [
          { accountId: await accountId('1110'), debit: 500 },
          { accountId: await accountId('3000'), credit: 450 },
        ],
      });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('€50.00 is missing on the credit side');
  });

  it('saves a balanced entry, reverses it, and refuses to reverse an entry a document wrote', async () => {
    const saved = await api()
      .post('/api/books/entries')
      .set(auth())
      .send({
        date: today(),
        description: 'Owner put money in',
        lines: [
          { accountId: await accountId('1110'), debit: 500 },
          { accountId: await accountId('3000'), credit: 500 },
        ],
      });
    expect(saved.status).toBe(201);
    expect(saved.body.data).toMatchObject({ kind: 'manual', total: 500 });
    expect((await balances())['3000']).toBe(-500);

    const reversed = await api().post(`/api/books/entries/${saved.body.data.id}/reverse`).set(auth());
    expect(reversed.status).toBe(201);
    expect((await balances())['3000'] ?? 0).toBe(0);
    expect((await api().post(`/api/books/entries/${saved.body.data.id}/reverse`).set(auth())).status).toBe(400);

    const saleEntry = (await entriesFor('sale', await sell()))[0]!;
    const refused = await api().post(`/api/books/entries/${saleEntry.id}/reverse`).set(auth());
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('Change or undo the document');
  });
});

describe('the first day of the books', () => {
  it('leaves documents before it out, and posts again when it moves', async () => {
    const saleId = await sell();
    await sql`update sales set sale_date = sale_date - interval '40 days' where id = ${saleId}`.execute(context.db);

    const start = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const set = await api().put('/api/books/settings').set(auth()).send({ startDay: start });
    expect(set.status).toBe(200);
    expect(set.body.data.startDay).toBe(start);
    expect(await entriesFor('sale', saleId)).toHaveLength(0);

    const before = await api().post('/api/books/entries').set(auth()).send({ date: '2000-01-01', description: 'old', lines: [] });
    expect(before.status).toBe(400);
    expect(before.body.message).toContain('The books start on');

    await api().put('/api/books/settings').set(auth()).send({ startDay: '2000-01-01' });
    expect(await entriesFor('sale', saleId)).toHaveLength(1);
  });

  it('posts to the account a movement is linked to', async () => {
    const services = (await context.db.selectFrom('ledger_accounts').select('id').where('number', '=', '4100').executeTakeFirstOrThrow()).id;
    expect((await api().put('/api/books/settings').set(auth()).send({ links: { revenue: services } })).status).toBe(200);
    const [entry] = await entriesFor('sale', await sell());
    expect(readLines(entry!)).toContain('4100 Cr 84.75');
  });
});

describe('downloads', () => {
  it('gives the trial balance, journal, general ledger and an account card as Excel files', async () => {
    await sell();
    const cash = (await context.db.selectFrom('ledger_accounts').select('id').where('number', '=', '1110').executeTakeFirstOrThrow()).id;
    for (const path of ['trial-balance.xlsx', 'journal.xlsx', 'ledger.xlsx', `accounts/${cash}/card.xlsx`]) {
      const response = await api().get(`/api/books/${path}?${PERIOD}&lang=sq&tz=Europe/Belgrade`).set(auth()).buffer(true);
      expect(response.status, path).toBe(200);
      expect(response.headers['content-type']).toContain('spreadsheetml');
    }
  });
});

describe('stock counts', () => {
  it('posts an approved shortage at cost against stock corrections', async () => {
    const started = await api().post('/api/stock-counts').set(auth()).send({});
    expect(started.status).toBe(201);
    const countId = started.body.data.id;
    const line = await context.db
      .insertInto('stock_count_lines')
      .values({ count_id: countId, product_id: productId, counted_quantity: 47, expected_quantity: 50, unit_cost: 60, status: 'approved', decided_at: new Date() })
      .returning('id')
      .executeTakeFirstOrThrow();
    const [entry] = await entriesFor('count', countId);
    expect(entry!.source).toBe(`count_line:${line.id}`);
    expect(readLines(entry!)).toEqual(['1340 Cr 180', '5400 Dr 180']);
  });
});
