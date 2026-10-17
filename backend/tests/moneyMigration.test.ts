import { type Kysely, sql } from 'kysely';
import { Migrator } from 'kysely/migration';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { runMigrations } from '../src/database/migrator.js';
import { migrations } from '../src/database/migrations/index.js';
import { loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;

beforeAll(async () => {
  context = await setupTestApp();
});
afterAll(() => context.db.destroy());

describe('bringing existing money into places', () => {
  it("puts each supplier payment and customer payment in its place, and the books' cash and bank links on the till and the bank", async () => {
    await resetData(context.db);
    await seedBooks(context.db as never);
    const token = await loginAs(context, 'admin');
    const db = context.db as unknown as Kysely<unknown>;
    // Back to just before the places, however many migrations came after them.
    const stepBack = await new Migrator({ db, provider: { getMigrations: async () => migrations } }).migrateTo('041_vat');
    if (stepBack.error) throw stepBack.error;

    await sql`insert into suppliers (id, name) values (3, 'Fresh Foods')`.execute(db);
    await sql`insert into supplier_bills (id, supplier_id, issued_on, amount) values (9, 3, '2026-09-11', 300)`.execute(db);
    await sql`insert into supplier_payments (bill_id, amount, paid_on, method) values (9, 100, '2026-09-12', 'drawer'), (9, 50, '2026-09-13', 'cash'), (9, 25, '2026-09-14', 'bank')`.execute(db);
    await sql`insert into customers (id, name) values (4, 'Arben')`.execute(db);
    await sql`insert into tab_entries (customer_id, kind, amount) values (4, 'charge', 30), (4, 'payment', 20)`.execute(db);

    await runMigrations(db, 'latest');

    const places = (await sql<{ id: number; kind: string; carwash_id: number | null; is_default: boolean; number: string }>`
      select p.id, p.kind, p.carwash_id, p.is_default, a.number from money_places p join ledger_accounts a on a.id = p.account_id order by p.id
    `.execute(db)).rows;
    const shopTill = places.find((place) => place.kind === 'till' && place.carwash_id === null)!;
    const safe = places.find((place) => place.kind === 'safe')!;
    const bank = places.find((place) => place.kind === 'bank')!;
    expect([shopTill.number, bank.number, safe.number]).toEqual(['1110', '1120', '1111']);

    const payments = (await sql<{ method: string; place_id: number }>`select method, place_id from supplier_payments order by paid_on`.execute(db)).rows;
    expect(payments).toEqual([
      { method: 'drawer', place_id: shopTill.id },
      { method: 'cash', place_id: safe.id },
      { method: 'bank', place_id: bank.id },
    ]);
    expect((await sql<{ place_id: number | null }>`select place_id from tab_entries order by id`.execute(db)).rows).toEqual([{ place_id: null }, { place_id: shopTill.id }]);
    const links = (await sql<{ key: string; number: string }>`select l.key, a.number from ledger_links l join ledger_accounts a on a.id = l.account_id where l.key in ('cash', 'bank', 'owner_in', 'owner_out') order by l.key`.execute(db)).rows;
    expect(links).toEqual([
      { key: 'owner_in', number: '3000' },
      { key: 'owner_out', number: '3100' },
    ]);

    const api = request(context.app);
    const bill = (await api.get('/api/bills/9').set({ Authorization: `Bearer ${token}` })).body.data;
    expect(bill.payments.map((payment: { place: { kind: string } }) => payment.place.kind).sort()).toEqual(['bank', 'safe', 'till']);
  });
});
