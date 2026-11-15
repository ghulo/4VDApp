import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { addMonths, monthEnd, monthlyAmount, projection } from '../src/services/assets/depreciation.js';
import { loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let employeeToken: string;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  await seedBooks(context.db as never);
  adminToken = await loginAs(context, 'admin');
  employeeToken = await loginAs(context, 'employee');
});
afterAll(() => context.db.destroy());

const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);
const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => `${today().slice(0, 7)}-01`;
/** The 10th of the month `count` months from now. */
const tenth = (count: number) => `${addMonths(thisMonth(), count).slice(0, 8)}10`;

interface Line {
  accountNumber: string;
  debit: number;
  credit: number;
}
const readLines = (lines: Line[]) => lines.map((line) => `${line.accountNumber} ${line.debit > 0 ? `Dr ${line.debit}` : `Cr ${line.credit}`}`).sort();

/** Every account's balance from the posted entries (reversals included), by number. */
async function balances(): Promise<Record<string, number>> {
  await api().get('/api/assets').set(auth());
  const { rows } = await sql<{ number: string; balance: string }>`
    select a.number, sum(l.debit - l.credit)::text as balance from ledger_lines l join ledger_accounts a on a.id = l.account_id group by a.number
  `.execute(context.db);
  return Object.fromEntries(rows.map((row) => [row.number, Number(row.balance)]));
}

async function entryLines(sourceKey: string): Promise<string[]> {
  const entry = await context.db
    .selectFrom('ledger_entries')
    .select('id')
    .where('source_key', '=', sourceKey)
    .where('kind', '=', 'auto')
    .where('id', 'not in', context.db.selectFrom('ledger_entries').select('reverses_id').where('reverses_id', 'is not', null).$narrowType<{ reverses_id: number }>())
    .executeTakeFirst();
  if (!entry) return [];
  const lines = await context.db
    .selectFrom('ledger_lines as l')
    .innerJoin('ledger_accounts as a', 'a.id', 'l.account_id')
    .select(['a.number as accountNumber', 'l.debit', 'l.credit'])
    .where('l.entry_id', '=', entry.id)
    .execute();
  return readLines(lines.map((line) => ({ accountNumber: line.accountNumber, debit: Number(line.debit), credit: Number(line.credit) })));
}

async function supplier(): Promise<number> {
  const response = await api().post('/api/suppliers').set(auth()).send({ name: 'Tech Shop', nui: '811234567' });
  return response.body.data.id;
}

async function equipmentBill(supplierId: number, issuedOn: string, lines: Array<{ category: string; description: string; amount: number }>) {
  const response = await api()
    .post('/api/bills')
    .set(auth())
    .send({ supplierId, issuedOn, dueOn: null, number: 'TS-1', pricesIncludeVat: false, lines: lines.map((line) => ({ kind: 'equipment', vatRate: 18, ...line })) });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data;
}

async function shopTill(): Promise<number> {
  const response = await api().get('/api/money/places').set(auth());
  return response.body.data.find((place: { kind: string; carwashId: number | null }) => place.kind === 'till' && place.carwashId === null).id;
}

const assets = async () => (await api().get('/api/assets').set(auth())).body.data as Array<Record<string, unknown> & { id: number }>;

describe('depreciation arithmetic', () => {
  const fridge = { category: 'equipment' as const, cost: 1000, residual: 0, rate: 20, openingDepreciated: 0, inUseFrom: '2026-01-15', disposedOn: null };

  it('works out a month as a year’s rate of the cost over 12, and nothing for land', () => {
    expect(monthlyAmount(fridge)).toBe(16.67);
    expect(monthlyAmount({ ...fridge, residual: 400 })).toBe(10);
    expect(monthlyAmount({ ...fridge, category: 'land', rate: 0 })).toBe(0);
  });

  it('stops exactly at the cost less what it is still worth, with a smaller last month', () => {
    const plan = projection(fridge, 0, '2026-01-01');
    expect(plan[0]).toEqual({ month: '2026-02-01', amount: 16.67 });
    expect(plan).toHaveLength(60);
    expect(plan.at(-1)!.amount).toBe(16.47);
    expect(Math.round(plan.reduce((sum, month) => sum + month.amount, 0) * 100) / 100).toBe(1000);
  });

  it('counts months across a year’s end', () => {
    expect(addMonths('2026-11-01', 3)).toBe('2027-02-01');
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
    expect(monthEnd('2028-02-01')).toBe('2028-02-29');
  });
});

describe('the fixed assets register', () => {
  it('takes equipment in from a bill and posts a month of depreciation for every month that is over', async () => {
    const supplierId = await supplier();
    await equipmentBill(supplierId, tenth(-4), [{ category: 'equipment', description: 'Drinks fridge', amount: 1200 }]);

    const [fridge] = await assets();
    expect(fridge).toMatchObject({ name: 'Drinks fridge', category: 'equipment', cost: 1200, rate: 20, monthly: 20, depreciated: 60, value: 1140, status: 'in_use', small: false });
    expect(fridge!.bill).toMatchObject({ number: 'TS-1', supplier: 'Tech Shop' });

    const months = await context.db.selectFrom('depreciation_months').select('id').orderBy('month').execute();
    expect(months).toHaveLength(3);
    expect(await entryLines(`depreciation:${months[0]!.id}`)).toEqual(['1920 Cr 20', '6150 Dr 20']);
    const books = await balances();
    expect(books['1700']).toBe(1200);
    expect(books['1920']).toBe(-60);
    expect(books['6150']).toBe(60);

    // The register and the books agree.
    const check = (await api().get('/api/assets/check').set(auth())).body.data;
    expect(check).toEqual([expect.objectContaining({ category: 'equipment', cost: 1200, depreciated: 60, booksCost: 1200, booksDepreciated: 60, costAccount: '1700', depreciationAccount: '1920' })]);

    // A changed rate changes only the months still to come.
    const changed = await api().patch(`/api/assets/${fridge!.id}`).set(auth()).send({ rate: 10 });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.data).toMatchObject({ depreciated: 60, monthly: 10 });
    expect(changed.body.data.months).toHaveLength(3);
    expect(changed.body.data.plan[0]).toEqual({ month: thisMonth(), amount: 10 });
    // Its cost comes from the bill.
    expect((await api().patch(`/api/assets/${fridge!.id}`).set(auth()).send({ cost: 900 })).status).toBe(409);
  });

  it('sells an asset with VAT: money in, VAT owed, cost and depreciation off, the loss booked, and a row in the VAT return', async () => {
    const supplierId = await supplier();
    await equipmentBill(supplierId, tenth(-4), [{ category: 'equipment', description: 'Drinks fridge', amount: 1200 }]);
    const [fridge] = await assets();
    const till = await shopTill();

    const sold = await api()
      .post(`/api/assets/${fridge!.id}/dispose`)
      .set(auth())
      .send({ kind: 'sold', day: today(), amount: 1180, vatRate: 18, buyerName: 'Market Dukagjini', paidPlaceId: till });
    expect(sold.status, JSON.stringify(sold.body)).toBe(200);
    // Its leaving month counts too: four months of 20.
    expect(sold.body.data).toMatchObject({ status: 'sold', depreciated: 80, disposal: { kind: 'sold', net: 1000, vat: 180, result: -120, buyer: 'Market Dukagjini' } });
    expect(await entryLines(`asset:${fridge!.id}`)).toEqual(['1110 Dr 1180', '1700 Cr 1200', '1920 Dr 80', '2340 Cr 180', '8200 Dr 120']);

    const vat = (await api().get(`/api/vat/${today().slice(0, 7)}`).set(auth())).body.data;
    expect(vat.items).toContainEqual(expect.objectContaining({ kind: 'asset_sale', number: 'Drinks fridge', party: 'Market Dukagjini', boxes: { 12: 1000, 13: 180 } }));

    // Not twice; and undone, it is back in use, its entry reversed and this month left to the month's end.
    expect((await api().post(`/api/assets/${fridge!.id}/dispose`).set(auth()).send({ kind: 'scrapped', day: today() })).status).toBe(409);
    const back = await api().post(`/api/assets/${fridge!.id}/undo-disposal`).set(auth());
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.data).toMatchObject({ status: 'in_use', depreciated: 60, disposal: null });
    const books = await balances();
    expect(books['2340'] ?? 0).toBe(0);
    expect(books['1700']).toBe(1200);
    expect(books['1920']).toBe(-60);
  });

  it('throws an asset away at its value left, as a loss', async () => {
    const supplierId = await supplier();
    await equipmentBill(supplierId, tenth(-4), [{ category: 'furniture', description: 'Shelves', amount: 600 }]);
    const [shelves] = await assets();
    const gone = await api().post(`/api/assets/${shelves!.id}/dispose`).set(auth()).send({ kind: 'scrapped', day: today(), note: 'Broken' });
    expect(gone.status, JSON.stringify(gone.body)).toBe(200);
    expect(await entryLines(`asset:${shelves!.id}`)).toEqual(['1600 Cr 600', '1910 Dr 40', '8200 Dr 560']);
  });

  it('takes the assets out with their bill, and a credit gives one back to the supplier', async () => {
    const supplierId = await supplier();
    const saved = await equipmentBill(supplierId, tenth(-4), [
      { category: 'equipment', description: 'Scale', amount: 300 },
      { category: 'equipment', description: 'Printer', amount: 240 },
    ]);
    expect(await assets()).toHaveLength(2);

    const credit = await api()
      .post(`/api/bills/${saved.id}/credit`)
      .set(auth())
      .send({ returnsStock: false, number: 'CR-1', issuedOn: today(), pricesIncludeVat: false, lines: [{ kind: 'equipment', category: 'equipment', description: 'Printer', amount: 240, vatRate: 18 }] });
    expect(credit.status, JSON.stringify(credit.body)).toBe(201);
    const printer = (await assets()).find((asset) => asset.name === 'Printer')!;
    expect(printer).toMatchObject({ status: 'returned', disposal: { kind: 'returned', creditBill: { id: credit.body.data.id } } });
    // The credit took the cost off; its depreciation (4 months of 4) comes back out of the cost.
    expect(await entryLines(`asset:${printer.id}`)).toEqual(['1920 Dr 16', '6150 Cr 16']);
    expect((await balances())['1700']).toBe(300);

    // Voiding the credit brings it back; voiding the bill takes everything out of the register and the books.
    expect((await api().post(`/api/bills/${credit.body.data.id}/void`).set(auth()).send({ note: 'Wrong' })).status).toBe(200);
    expect((await assets()).find((asset) => asset.name === 'Printer')).toMatchObject({ status: 'in_use' });
    expect((await api().post(`/api/bills/${saved.id}/void`).set(auth()).send({ note: 'Wrong' })).status).toBe(200);
    expect(await assets()).toHaveLength(0);
    const books = await balances();
    expect(books['1700'] ?? 0).toBe(0);
    expect(books['1920'] ?? 0).toBe(0);
    expect(books['6150'] ?? 0).toBe(0);
  });

  it('splits a bill line for several things into equal parts before its depreciation starts', async () => {
    const supplierId = await supplier();
    await equipmentBill(supplierId, today(), [{ category: 'furniture', description: 'Chairs', amount: 100 }]);
    const [chairs] = await assets();
    const split = await api().post(`/api/assets/${chairs!.id}/split`).set(auth()).send({ pieces: 3 });
    expect(split.status, JSON.stringify(split.body)).toBe(200);
    expect((await assets()).map((asset) => asset.cost).sort()).toEqual([33.33, 33.33, 33.34]);
  });

  it('takes in something already owned with its wear before the books started, and posts only the months after', async () => {
    const start = addMonths(thisMonth(), -2);
    await sql`insert into settings (key, value) values ('books_start', to_jsonb(${start}::text))`.execute(context.db);
    const inUseFrom = `${addMonths(thisMonth(), -14).slice(0, 8)}05`;

    const suggested = await api().get(`/api/assets/opening?category=vehicle&cost=12000&inUseFrom=${inUseFrom}`).set(auth());
    // 11 months at 200 before the books' first month.
    expect(suggested.body.data).toEqual({ openingDepreciated: 2200 });

    const made = await api()
      .post('/api/assets')
      .set(auth())
      .send({ name: 'Delivery van', code: 'VAN-1', category: 'vehicle', boughtOn: inUseFrom, inUseFrom, cost: 12000 });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.data).toMatchObject({ openingDepreciated: 2200, depreciated: 2600, value: 9400, bill: null });
    expect(made.body.data.months).toEqual([
      { month: start, amount: 200 },
      { month: addMonths(start, 1), amount: 200 },
    ]);
    // Its cost is in the opening balances: only depreciation posts.
    const books = await balances();
    expect(books['1710'] ?? 0).toBe(0);
    expect(books['1930']).toBe(-400);

    const year = Number(today().slice(0, 4));
    const schedule = (await api().get(`/api/assets/schedule/${year}`).set(auth())).body.data;
    expect(schedule[0]).toMatchObject({ name: 'Delivery van', cost: 12000 });

    // Typed in by mistake: gone from the register, its months reversed.
    expect((await api().delete(`/api/assets/${made.body.data.id}`).set(auth())).status).toBe(200);
    expect((await balances())['1930'] ?? 0).toBe(0);
  });

  it('refuses land a rate, and keeps employees out', async () => {
    const land = await api().post('/api/assets').set(auth()).send({ name: 'Plot', category: 'land', boughtOn: today(), inUseFrom: today(), cost: 50000, rate: 5 });
    expect(land.status).toBe(400);
    expect((await api().get('/api/assets').set(auth(employeeToken))).status).toBe(403);
    expect((await api().post('/api/assets').set(auth(employeeToken)).send({ name: 'Plot', category: 'land', boughtOn: today(), inUseFrom: today(), cost: 50000 })).status).toBe(403);
  });

  it('downloads the register and the year’s schedule in Excel', async () => {
    const supplierId = await supplier();
    await equipmentBill(supplierId, tenth(-2), [{ category: 'equipment', description: 'Till', amount: 800 }]);
    const register = await api().get('/api/assets/download?lang=en').set(auth());
    expect(register.status).toBe(200);
    expect(register.headers['content-type']).toContain('spreadsheetml');
    const schedule = await api().get(`/api/assets/schedule/${today().slice(0, 4)}/download`).set(auth());
    expect(schedule.status).toBe(200);
  });
});
