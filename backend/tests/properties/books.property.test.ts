import fc from 'fast-check';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedBooks } from '../../src/database/books.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from '../helpers/testApp.js';

/**
 * Random days of trading through the real API and posting rules: sales at
 * random prices and VAT rates, part returns and supplier bills. Whatever the
 * mix, the books must balance to the cent and the VAT return must agree with
 * the VAT accounts in the books. Few runs: each one resets the test database.
 */

let context: TestContext;
let token: string;

beforeAll(async () => {
  context = await setupTestApp();
});
afterAll(() => context.db.destroy());

const api = () => request(context.app);
const auth = () => ({ Authorization: `Bearer ${token}` });
const cents = (amount: number) => Math.round(amount * 100);
const today = () => new Date().toISOString().slice(0, 10);
const month = () => today().slice(0, 7);

const productArb = fc.record({ priceCents: fc.integer({ min: 1, max: 50_000 }), vatRate: fc.constantFrom(0, 8, 18) });
const opArb = fc.oneof(
  fc.record({ kind: fc.constant('sale' as const), product: fc.nat(), quantity: fc.integer({ min: 1, max: 5 }) }),
  fc.record({ kind: fc.constant('return' as const), sale: fc.nat() }),
  fc.record({ kind: fc.constant('bill' as const), netCents: fc.integer({ min: 1, max: 500_000 }) }),
);

interface Row {
  number: string;
  debit: number;
  credit: number;
  closing: number;
}

describe('random trading days', () => {
  it('balance the books to the cent and match the VAT return to the VAT accounts', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(productArb, { minLength: 1, maxLength: 4 }), fc.array(opArb, { minLength: 1, maxLength: 12 }), async (products, ops) => {
        await resetData(context.db);
        await seedBooks(context.db as never);
        token = await loginAs(context, 'admin');
        await api()
          .put('/api/books/settings')
          .set(auth())
          .send({ startDay: `${month()}-01` });
        const productIds: number[] = [];
        for (const product of products) {
          productIds.push(await createTestProduct(context, token, { price: product.priceCents / 100, costPrice: 0.01, stock: 1000, vatRate: product.vatRate }));
        }
        const supplierId = (await api().post('/api/suppliers').set(auth()).send({ name: 'Fresh Foods', nui: '811234567' })).body.data.id;

        const sales: number[] = [];
        let bills = 0;
        for (const op of ops) {
          if (op.kind === 'sale') {
            const response = await api()
              .post('/api/sales')
              .set(auth())
              .send({ productId: productIds[op.product % productIds.length], quantity: op.quantity });
            expect(response.status).toBe(201);
            sales.push(response.body.data.id);
          } else if (op.kind === 'return' && sales.length > 0) {
            // Each sale is returned at most once, one unit, so the return is always allowed.
            const [saleId] = sales.splice(op.sale % sales.length, 1);
            const response = await api().post(`/api/sales/${saleId}/returns`).set(auth()).send({ quantity: 1, condition: 'resellable' });
            expect(response.status).toBe(201);
          } else if (op.kind === 'bill') {
            const vatCents = Math.round(op.netCents * 0.18);
            bills += 1;
            const response = await api()
              .post('/api/bills')
              .set(auth())
              .send({ supplierId, number: `FF-${bills}`, issuedOn: today(), amount: (op.netCents + vatCents) / 100, vatAmount: vatCents / 100 });
            expect(response.status).toBe(201);
          }
        }

        const trial = await api().get(`/api/books/trial-balance?from=${month()}-01&to=2100-12-31`).set(auth());
        expect(trial.status).toBe(200);
        const rows: Row[] = trial.body.data.rows;
        const total = (pick: (row: Row) => number) => rows.reduce((sum, row) => sum + cents(pick(row)), 0);
        expect(total((row) => row.debit)).toBe(total((row) => row.credit));
        expect(total((row) => row.closing)).toBe(0);

        const vat = await api().get(`/api/vat/${month()}`).set(auth());
        expect(vat.status).toBe(200);
        const boxes: Record<number, number> = vat.body.data.boxes;
        const closing = (number: string) => cents(rows.find((row) => row.number === number)?.closing ?? 0);
        // VAT charged (box 30) is what 2340 VAT owed holds; VAT claimed (box 67) is what 1260 VAT to claim holds.
        expect(cents(boxes[30]!) - cents(boxes[67]!)).toBe(0 - (closing('2340') + closing('1260')));
      }),
      { numRuns: 12 },
    );
  }, 180_000);
});
