import { type Kysely, sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { Migrator } from 'kysely/migration';
import { runMigrations } from '../src/database/migrator.js';
import { migrations } from '../src/database/migrations/index.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;

beforeAll(async () => {
  context = await setupTestApp();
});
afterAll(() => context.db.destroy());

describe('moving expenses into bills', () => {
  it('turns each expense into a bill paid on the spot and each monthly rule into a repeat, keeping their ids', async () => {
    await resetData(context.db);
    await seedBooks(context.db as never);
    const token = await loginAs(context, 'admin');
    const productId = await createTestProduct(context, token, { price: 10, costPrice: 5, stock: 0, vatRate: 18 });
    const db = context.db as unknown as Kysely<unknown>;
    // Back to just before bills took over expenses, however many migrations came after it.
    const stepBack = await new Migrator({ db, provider: { getMigrations: async () => migrations } }).migrateTo('039_books');
    if (stepBack.error) throw stepBack.error;

    const carwashId = (await sql<{ id: number }>`select id from carwashes limit 1`.execute(db)).rows[0]!.id;
    await sql`insert into recurring_expenses (id, amount, category, place, note, day_of_month, last_filled_on) values (7, 300, 'rent', 'shop', 'Shop rent', 5, '2026-09-05')`.execute(db);
    await sql`insert into expenses (id, day, amount, category, place, note, recurring_id) values
      (41, '2026-09-05', 300, 'rent', 'shop', 'Shop rent', 7),
      (42, '2026-09-10', 45.5, 'water', 'carwash', null, null)`.execute(db);
    await sql`update expenses set carwash_id = ${carwashId} where id = 42`.execute(db);
    // A delivery's bill: its products become its lines.
    await sql`insert into suppliers (id, name) values (3, 'Fresh Foods')`.execute(db);
    await sql`insert into purchase_orders (id, supplier_id, status) values (5, 3, 'received')`.execute(db);
    await sql`insert into purchase_order_lines (order_id, product_id, quantity, unit_cost, received_quantity) values (5, ${productId}, 4, 5.9, 4)`.execute(db);
    await sql`insert into supplier_bills (id, supplier_id, order_id, issued_on, amount) values (9, 3, 5, '2026-09-11', 23.6)`.execute(db);

    await runMigrations(db, 'latest');

    const api = request(context.app);
    const auth = { Authorization: `Bearer ${token}` };
    const range = { startDate: '2026-09-01T00:00:00Z', endDate: '2026-09-30T23:59:59Z' };
    const { expenses, totals } = (await api.get('/api/expenses').set(auth).query(range)).body.data;
    expect(expenses.map((row: { id: number; day: string; amount: number; paidNow: boolean; recurringId: number | null }) => [row.id, row.day, row.amount, row.paidNow, row.recurringId])).toEqual([
      [42, '2026-09-10', 45.5, true, null],
      [41, '2026-09-05', 300, true, 7],
    ]);
    expect(totals.byPlace).toEqual({ shop: 300, carwash: 45.5, both: 0 });

    const rent = (await api.get(`/api/bills/${expenses[1].billId}`).set(auth)).body.data;
    expect(rent).toMatchObject({ supplier: null, paidNow: true, status: 'paid', repeatId: 7, amount: 300 });
    expect(rent.payments).toMatchObject([{ method: 'cash', amount: 300, paidOn: '2026-09-05' }]);

    const repeats = (await api.get('/api/expenses/recurring').set(auth)).body.data;
    expect(repeats).toMatchObject([{ id: 7, amount: 300, category: 'rent', dayOfMonth: 5 }]);

    const delivery = (await api.get('/api/bills/9').set(auth)).body.data;
    expect(delivery.lines).toMatchObject([{ kind: 'product', productId, quantity: 4, gross: 23.6, vat: 3.6, fromDelivery: true }]);

    // The next new line and repeat don't collide with the kept ids.
    const added = await api.post('/api/expenses').set(auth).send({ day: '2026-09-12', amount: 10, category: 'office', place: 'shop' });
    expect(added.status).toBe(201);
    expect(added.body.data.id).toBeGreaterThan(42);
  });
});
