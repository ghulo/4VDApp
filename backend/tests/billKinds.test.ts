import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { billFigures, priceKeepingMargin } from '../src/services/bills/billFigures.js';
import { createTestProduct, loginAs, resetData, setupTestApp, stockOf, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let productId: number;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  await seedBooks(context.db as never);
  adminToken = await loginAs(context, 'admin');
  // Sells at €100 (18% VAT inside) and costs €50.
  productId = await createTestProduct(context, adminToken, { price: 100, costPrice: 50, stock: 10, vatRate: 18 });
});
afterAll(() => context.db.destroy());

const auth = () => ({ Authorization: `Bearer ${adminToken}` });
const api = () => request(context.app);
const today = () => new Date().toISOString().slice(0, 10);

interface Entry {
  kind: string;
  lines: Array<{ accountNumber: string; debit: number; credit: number }>;
}
const readLines = (entry: Entry) => entry.lines.map((line) => `${line.accountNumber} ${line.debit > 0 ? `Dr ${line.debit}` : `Cr ${line.credit}`}`).sort();
async function entriesFor(source: string, id: number): Promise<Entry[]> {
  const response = await api().get(`/api/books/entries?source=${source}&id=${id}`).set(auth());
  expect(response.status).toBe(200);
  return response.body.data;
}

let nuiCount = 0;
async function supplier(fields: Record<string, unknown> = {}): Promise<number> {
  nuiCount += 1;
  const response = await api().post('/api/suppliers').set(auth()).send({ name: 'Fresh Foods', nui: `8112345${String(nuiCount).padStart(2, '0')}`, ...fields });
  expect(response.status).toBe(201);
  return response.body.data.id;
}

async function bill(body: Record<string, unknown>) {
  const response = await api().post('/api/bills').set(auth()).send({ issuedOn: today(), dueOn: null, number: null, ...body });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data;
}

const product = (quantity: number, unitPrice: number) => ({ kind: 'product', productId, quantity, unitPrice });

describe('the bill figures', () => {
  it('spreads duty and transport onto goods by value, the last line taking the rounding', () => {
    const figures = billFigures({
      abroad: true,
      pricesIncludeVat: true,
      withholdingType: null,
      customs: { vat: 30, duty: 10 },
      lines: [
        { kind: 'product', quantity: 3, unitPrice: 10, vatRate: 18, productVatRate: 18 },
        { kind: 'product', quantity: 1, unitPrice: 70, vatRate: 18, productVatRate: 18 },
        { kind: 'cost', amount: 10, category: 'transport', vatRate: 18 },
      ],
    });
    expect(figures.lines.map((line) => line.landed)).toEqual([36, 84, 10]);
    expect(figures.lines[2]!.spread).toBe(true);
    expect(figures.stock).toBe(120);
    expect(figures.costs).toEqual({});
    expect(figures.vatToClaim).toBe(30);
    expect(figures.customs).toBe(40);
    // €36 for 3, with the product's 18% VAT back on, as 4VD keeps costs.
    expect(figures.lines[0]!.unitCost).toBe(14.16);
  });

  it('keeps the old margin when suggesting a new shelf price, at a price people are used to', () => {
    expect(priceKeepingMargin(50, 100, 55)).toBe(110.99);
    expect(priceKeepingMargin(10, 20, 12.6)).toBe(25.49);
    expect(priceKeepingMargin(0.6, 1, 0.82)).toBe(1.39);
    expect(priceKeepingMargin(0.6, 1, 0.84)).toBe(1.44);
  });
});

describe('one bill form for every kind of bill', () => {
  it('mixes goods and a delivery fee: stock in at the new cost, the fee as a cost, VAT to claim', async () => {
    const supplierId = await supplier();
    const saved = await bill({ supplierId, lines: [product(2, 59), { kind: 'cost', category: 'transport', amount: 11.8, vatRate: 18 }] });
    expect(saved.amount).toBe(129.8);
    expect(saved.vatToClaim).toBe(19.8);
    expect(saved.lines.map((line: { kind: string; landed: number }) => [line.kind, line.landed])).toEqual([['product', 100], ['cost', 10]]);
    expect(await stockOf(context, productId)).toBe(12);
    const cost = await context.db.selectFrom('products').select('cost_price').where('id', '=', productId).executeTakeFirstOrThrow();
    expect(Number(cost.cost_price)).toBe(59);

    const [entry] = await entriesFor('bill', saved.id);
    expect(readLines(entry!)).toEqual(['1260 Dr 19.8', '1340 Dr 100', '2000 Cr 129.8', '6740 Dr 10']);

    // The supplier remembers what it sells and at which VAT, for its next bill.
    const remembered = (await api().get('/api/suppliers').set(auth())).body.data.find((row: { id: number }) => row.id === supplierId);
    expect(remembered).toMatchObject({ usualKind: 'product', usualCategory: 'transport', usualVatRate: 18, withholdingType: null });
  });

  it('books equipment as a fixed asset, and prices typed without VAT get it added', async () => {
    const supplierId = await supplier();
    const saved = await bill({ supplierId, pricesIncludeVat: false, lines: [{ kind: 'equipment', category: 'equipment', description: 'Drinks fridge', amount: 1000, vatRate: 18 }] });
    expect(saved.amount).toBe(1180);
    const [entry] = await entriesFor('bill', saved.id);
    expect(readLines(entry!)).toEqual(['1260 Dr 180', '1700 Dr 1000', '2000 Cr 1180']);
  });

  it('holds tax back for ATK: taken off what the supplier is owed and booked to 2370', async () => {
    const landlord = await supplier({ name: 'Landlord' });
    const saved = await bill({ supplierId: landlord, withholdingType: 'rent', lines: [{ kind: 'cost', category: 'rent', amount: 500, vatRate: 0 }] });
    expect(saved).toMatchObject({ amount: 455, total: 500, withholding: { type: 'rent', rate: 9, amount: 45 } });
    const [entry] = await entriesFor('bill', saved.id);
    expect(readLines(entry!)).toEqual(['2000 Cr 455', '2370 Cr 45', '6650 Dr 500']);
    const remembered = (await api().get('/api/suppliers').set(auth())).body.data.find((row: { id: number }) => row.id === landlord);
    expect(remembered.withholdingType).toBe('rent');
  });

  it('handles goods from abroad: customs VAT to claim, duty and transport onto the cost, paid at the border', async () => {
    const abroad = await supplier({ name: 'Istanbul Toys', abroad: true });
    const saved = await bill({
      supplierId: abroad,
      lines: [product(10, 10), { kind: 'cost', category: 'transport', amount: 20 }],
      customs: { vat: 25.2, duty: 20, method: 'bank' },
    });
    expect(saved).toMatchObject({ abroad: true, amount: 120, vatToClaim: 25.2, customs: { vat: 25.2, duty: 20, method: 'bank' } });
    expect(saved.lines[0].landed).toBe(140);
    const cost = await context.db.selectFrom('products').select('cost_price').where('id', '=', productId).executeTakeFirstOrThrow();
    // €14 each landed, with 18% VAT on top as 4VD keeps costs.
    expect(Number(cost.cost_price)).toBe(16.52);
    const [entry] = await entriesFor('bill', saved.id);
    expect(readLines(entry!)).toEqual(['1120 Cr 45.2', '1260 Dr 25.2', '1340 Dr 140', '2000 Cr 120']);
  });

  it('lets a supplier abroad go without a Kosovo NUI, but not one at home', async () => {
    const abroad = await api().post('/api/suppliers').set(auth()).send({ name: 'Milano Coffee', nui: '', abroad: true });
    expect(abroad.status).toBe(201);
    expect(abroad.body.data).toMatchObject({ nui: null, abroad: true });
    const home = await api().post('/api/suppliers').set(auth()).send({ name: 'Local Ltd', nui: '' });
    expect(home.status).toBe(400);
  });

  it('charges VAT to yourself on a service from abroad, both ways so it nets to zero', async () => {
    const abroad = await supplier({ name: 'Ads Abroad', abroad: true });
    const saved = await bill({ supplierId: abroad, lines: [{ kind: 'cost', category: 'advertising', amount: 200, vatRate: 18 }] });
    expect(saved.amount).toBe(200);
    expect(saved.lines[0]).toMatchObject({ vatRate: 0, selfVat: 36 });
    const [entry] = await entriesFor('bill', saved.id);
    expect(readLines(entry!)).toEqual(['1260 Dr 36', '2000 Cr 200', '2340 Cr 36', '6010 Dr 200']);
  });

  it('says what saving will do before it is saved, with a price alert when the cost goes up', async () => {
    const supplierId = await supplier();
    const preview = await api()
      .post('/api/bills/preview')
      .set(auth())
      .send({ supplierId, issuedOn: today(), lines: [product(2, 59)] });
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({ stock: 100, vatToClaim: 18, owed: 118, withheld: 0 });
    expect(preview.body.data.priceAlerts).toEqual([
      { productId, name: 'Oak Chair', oldCost: 50, newCost: 59, price: 100, marginBefore: 50, marginAfter: 41, suggestedPrice: 118.99 },
    ]);
    // Nothing was saved.
    expect(await stockOf(context, productId)).toBe(10);
  });

  it('sets a new shelf price chosen from the alert, in the price history', async () => {
    const supplierId = await supplier();
    await bill({ supplierId, lines: [product(2, 59)], prices: [{ productId, price: 117.99 }] });
    const history = (await api().get(`/api/products/${productId}/price-history`).set(auth())).body.data;
    expect(history[0].price).toEqual({ from: 100, to: 117.99 });
  });

  it('needs a supplier for a bill to pay later, not for one paid now', async () => {
    const later = await api().post('/api/bills').set(auth()).send({ supplierId: null, issuedOn: today(), lines: [{ kind: 'cost', category: 'office', amount: 12 }] });
    expect(later.status).toBe(400);
    const now = await bill({ supplierId: null, paidNow: { method: 'cash' }, lines: [{ kind: 'cost', category: 'office', amount: 12, vatRate: 0 }] });
    expect(now).toMatchObject({ paidNow: true, status: 'paid', supplier: null });
  });

  it('takes typed stock back out when a bill is voided', async () => {
    const supplierId = await supplier();
    const saved = await bill({ supplierId, lines: [product(3, 59)] });
    expect(await stockOf(context, productId)).toBe(13);
    expect(await entriesFor('bill', saved.id)).toHaveLength(1);
    expect((await api().post(`/api/bills/${saved.id}/void`).set(auth()).send({ note: 'Typed twice' })).status).toBe(200);
    expect(await stockOf(context, productId)).toBe(10);
    const entries = await entriesFor('bill', saved.id);
    expect(entries.map((entry) => entry.kind)).toEqual(['auto', 'reversal']);
  });
});

describe('returns and credits', () => {
  it('returns units to the supplier: out of stock, off what is owed, the entry the other way round', async () => {
    const supplierId = await supplier();
    const saved = await bill({ supplierId, lines: [product(2, 59)] });
    const credit = await api()
      .post(`/api/bills/${saved.id}/credit`)
      .set(auth())
      .send({ returnsStock: true, number: 'CR-1', issuedOn: today(), lines: [product(1, 59)] });
    expect(credit.status, JSON.stringify(credit.body)).toBe(201);
    expect(credit.body.data).toMatchObject({ kind: 'credit', amount: 59, creditFor: { id: saved.id }, returnsStock: true, left: 0 });
    expect(await stockOf(context, productId)).toBe(11);

    const original = (await api().get(`/api/bills/${saved.id}`).set(auth())).body.data;
    expect(original).toMatchObject({ left: 59, status: 'partly_paid' });
    expect(original.credits).toHaveLength(1);
    const [entry] = await entriesFor('bill', credit.body.data.id);
    expect(readLines(entry!)).toEqual(['1260 Cr 9', '1340 Cr 50', '2000 Dr 59']);

    // Never more units back than came.
    const tooMany = await api().post(`/api/bills/${saved.id}/credit`).set(auth()).send({ returnsStock: true, number: null, issuedOn: today(), lines: [product(2, 59)] });
    expect(tooMany.status).toBe(400);

    // Voiding the return puts the units back and the bill owes again.
    expect((await api().post(`/api/bills/${credit.body.data.id}/void`).set(auth()).send({ note: 'Wrong' })).status).toBe(200);
    expect(await stockOf(context, productId)).toBe(12);
    expect((await api().get(`/api/bills/${saved.id}`).set(auth())).body.data.left).toBe(118);
  });

  it('a credit on a bill already paid leaves the supplier owing the shop', async () => {
    const supplierId = await supplier();
    const saved = await bill({ supplierId, lines: [{ kind: 'cost', category: 'repairs', amount: 100, vatRate: 0 }] });
    await api().post(`/api/bills/${saved.id}/payments`).set(auth()).send({ amount: 100, paidOn: today(), method: 'bank' });
    const credit = await api()
      .post(`/api/bills/${saved.id}/credit`)
      .set(auth())
      .send({ returnsStock: false, number: null, issuedOn: today(), lines: [{ kind: 'cost', category: 'repairs', amount: 20, vatRate: 0 }] });
    expect(credit.body.data).toMatchObject({ amount: 20, paid: 0, left: 20 });
    // A credit is never listed as something the shop owes.
    const open = (await api().get('/api/bills?status=open').set(auth())).body.data;
    expect(open).toHaveLength(0);
    const [entry] = await entriesFor('bill', credit.body.data.id);
    expect(readLines(entry!)).toEqual(['2000 Dr 20', '6670 Cr 20']);
  });
});

describe('pay later or paid now', () => {
  it('shows costs from bills to pay later on the Expenses page, and only an expense can be removed there', async () => {
    const supplierId = await supplier({ name: 'Power Co' });
    const saved = await bill({ supplierId, lines: [{ kind: 'cost', category: 'electricity', amount: 80, vatRate: 8 }] });
    const day = today();
    const range = { startDate: `${day}T00:00:00Z`, endDate: `${day}T23:59:59Z` };
    const { expenses, totals } = (await api().get('/api/expenses').set(auth()).query(range)).body.data;
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({ billId: saved.id, category: 'electricity', amount: 80, paidNow: false, supplierName: 'Power Co' });
    expect(totals.byCategory.electricity).toBe(80);
    expect((await api().delete(`/api/expenses/${expenses[0].id}`).set(auth())).status).toBe(409);

    const paid = await api().post('/api/expenses').set(auth()).send({ day, amount: 15, category: 'cleaning', place: 'shop' });
    expect(paid.status).toBe(201);
    expect((await api().delete(`/api/expenses/${paid.body.data.id}`).set(auth())).status).toBe(200);
    const after = (await api().get(`/api/bills/${paid.body.data.billId}`).set(auth())).body.data;
    expect(after.status).toBe('void');
    expect(after.payments[0].voided).toBe(true);
  });
});

describe('repeating bills', () => {
  it('makes a bill to pay later every month by itself, with the same days to pay', async () => {
    const landlord = await supplier({ name: 'Landlord' });
    await bill({
      supplierId: landlord,
      issuedOn: '2026-07-05',
      dueOn: '2026-07-15',
      repeatMonthly: true,
      lines: [{ kind: 'cost', category: 'rent', amount: 400, vatRate: 0 }],
    });
    const made = await context.container.supplierBillService.fillRepeats(new Date('2026-09-06T10:00:00Z'));
    expect(made).toBe(2);
    expect(await context.container.supplierBillService.fillRepeats(new Date('2026-09-06T12:00:00Z'))).toBe(0);
    const bills = (await api().get(`/api/bills?supplierId=${landlord}`).set(auth())).body.data;
    expect(bills.map((row: { issuedOn: string; dueOn: string }) => [row.issuedOn, row.dueOn]).sort()).toEqual([
      ['2026-07-05', '2026-07-15'],
      ['2026-08-05', '2026-08-15'],
      ['2026-09-05', '2026-09-15'],
    ]);
    const repeats = (await api().get('/api/bills/repeats').set(auth())).body.data;
    expect(repeats).toMatchObject([{ supplier: { name: 'Landlord' }, amount: 400, category: 'rent', dayOfMonth: 5 }]);
  });

  it('only lets costs repeat', async () => {
    const supplierId = await supplier();
    const response = await api().post('/api/bills').set(auth()).send({ supplierId, issuedOn: today(), repeatMonthly: true, lines: [product(1, 59)] });
    expect(response.status).toBe(400);
  });
});
