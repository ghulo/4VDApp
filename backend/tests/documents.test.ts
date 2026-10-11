import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { splitVat } from '../src/services/documents/vat.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let employeeToken: string;
let chair: number;
let bread: number;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  await context.db.updateTable('businesses').set({ nui: '811234567', address: 'Rruga B, Prishtinë' }).execute();
  adminToken = await loginAs(context, 'admin');
  employeeToken = await loginAs(context, 'employee');
  chair = await createTestProduct(context, adminToken, { name: 'Oak Chair', price: 118, stock: 20 });
  bread = await createTestProduct(context, adminToken, { name: 'Bread', price: 1.08, stock: 50, vatRate: 8 });
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);
const year = new Date().getFullYear();

async function checkout(token: string, items: Array<{ productId: number; quantity: number; discountPercent?: number }>, extra: Record<string, unknown> = {}) {
  const response = await api().post('/api/sales/basket').set(auth(token)).send({ items, ...extra });
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  return response.body.data as { sales: Array<{ id: number; invoice: { id: number; number: string } }>; invoice: { id: number; number: string } };
}

const getDocument = async (id: number, token = adminToken) => (await api().get(`/api/documents/${id}`).set(auth(token))).body.data;
const entryOf = async (action: string) =>
  (await context.db.selectFrom('activity_log').select('id').where('action', '=', action).orderBy('id', 'desc').executeTakeFirstOrThrow()).id;

describe('VAT', () => {
  it('should split a VAT-inclusive amount so net and VAT add up exactly', () => {
    expect(splitVat(118, 18)).toEqual({ net: 100, vat: 18 });
    expect(splitVat(10, 18)).toEqual({ net: 8.47, vat: 1.53 });
    expect(splitVat(5, 0)).toEqual({ net: 5, vat: 0 });
  });

  it('should refuse a VAT rate Kosovo does not have', async () => {
    const response = await api()
      .post('/api/products')
      .set(auth(adminToken))
      .send({ name: 'Odd', price: 1, categoryId: 1, vatRate: 20 });
    expect(response.status).toBe(400);
  });
});

describe('invoices', () => {
  it('should issue one numbered invoice per checkout, with VAT per line and per rate', async () => {
    const first = await checkout(employeeToken, [
      { productId: chair, quantity: 2 },
      { productId: bread, quantity: 10 },
    ]);
    expect(first.invoice.number).toBe(`F-${year}-000001`);
    expect(first.sales.every((sale) => sale.invoice.id === first.invoice.id)).toBe(true);

    const document = await getDocument(first.invoice.id);
    expect(document).toMatchObject({
      kind: 'invoice',
      seller: { name: 'Test shop', nui: '811234567', address: 'Rruga B, Prishtinë' },
      buyer: null,
      total: 246.8,
      netTotal: 210,
      vatTotal: 36.8,
      vatByRate: [
        { rate: 18, net: 200, vat: 36 },
        { rate: 8, net: 10, vat: 0.8 },
      ],
    });
    expect(document.lines).toHaveLength(2);

    const second = await checkout(employeeToken, [{ productId: chair, quantity: 1 }]);
    expect(second.invoice.number).toBe(`F-${year}-000002`);
  });

  it('should keep its own copy of the shop, so later profile edits leave it alone', async () => {
    const { invoice } = await checkout(adminToken, [{ productId: chair, quantity: 1 }]);
    await context.db.updateTable('businesses').set({ name: 'Renamed' }).execute();
    expect((await getDocument(invoice.id)).seller.name).toBe('Test shop');
  });

  it('should name a business customer as the buyer when the checkout goes on their tab', async () => {
    const customer = await api()
      .post('/api/customers')
      .set(auth(adminToken))
      .send({ name: 'Ndërtimi SH.P.K.', kind: 'business', nui: '811 234 568' });
    const { invoice } = await checkout(adminToken, [{ productId: chair, quantity: 1 }], { customerId: customer.body.data.id });
    expect((await getDocument(invoice.id)).buyer).toMatchObject({ name: 'Ndërtimi SH.P.K.', nui: '811234568' });
    const page = (await api().get(`/api/documents/${invoice.id}/print?language=sq`).set(auth(adminToken))).text;
    expect(page).toContain('Ndërtimi SH.P.K.');
    expect(page).not.toContain('class="buyer buyer--blank"');
  });

  it('should leave lines for the buyer to be written in by hand when the sale had no customer', async () => {
    const { invoice } = await checkout(adminToken, [{ productId: chair, quantity: 1 }]);
    const page = (await api().get(`/api/documents/${invoice.id}/print?language=sq`).set(auth(adminToken))).text;
    expect(page).toContain('<section class="buyer buyer--blank"><h2 class="spec">Blerësi</h2><p><span>Emri</span></p><p><span>NUI</span></p><p><span>Adresa</span></p></section>');
  });

  it("should list only one customer's invoices when asked, and say whose they are", async () => {
    const customer = await api().post('/api/customers').set(auth(adminToken)).send({ name: 'Arta', kind: 'person' });
    const customerId = customer.body.data.id;
    const { invoice } = await checkout(adminToken, [{ productId: chair, quantity: 1 }], { customerId });
    await checkout(adminToken, [{ productId: chair, quantity: 1 }]);

    const list = await api().get(`/api/documents?customerId=${customerId}`).set(auth(adminToken));
    expect(list.body.data.map((document: { id: number }) => document.id)).toEqual([invoice.id]);
    expect(list.body.data[0].customerId).toBe(customerId);
  });

  it('should invoice a single sale too', async () => {
    const response = await api().post('/api/sales').set(auth(employeeToken)).send({ productId: chair, quantity: 1 });
    expect(response.body.data.invoice.number).toBe(`F-${year}-000001`);
  });
});

describe('reversals', () => {
  it('should issue a credit note for an approved return, for the refund', async () => {
    const { sales, invoice } = await checkout(employeeToken, [{ productId: chair, quantity: 2 }]);
    await api().post(`/api/sales/${sales[0]!.id}/returns`).set(auth(adminToken)).send({ quantity: 1, condition: 'resellable', refundAmount: 100, notes: 'scratched' });

    const list = await api().get('/api/documents?kind=credit_note').set(auth(adminToken));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      number: `K-${year}-000001`,
      corrects: { id: invoice.id, number: invoice.number },
      reason: 'scratched',
      total: 100,
    });
  });

  it('should credit an undone sale and invoice it again when it is restored', async () => {
    const { sales, invoice } = await checkout(employeeToken, [{ productId: chair, quantity: 1 }]);
    const entryId = await entryOf('sale.recorded');

    await api().post(`/api/activity/${entryId}/undo`).set(auth(adminToken)).send({ note: 'wrong product' });
    const credits = (await api().get('/api/documents?kind=credit_note').set(auth(adminToken))).body.data;
    expect(credits[0]).toMatchObject({ corrects: { id: invoice.id }, total: 118, reason: 'wrong product' });

    await api().post(`/api/activity/${entryId}/restore`).set(auth(adminToken));
    const sale = (await api().get('/api/sales').set(auth(adminToken))).body.data.sales.find((row: { id: number }) => row.id === sales[0]!.id);
    expect(sale.invoice.number).toBe(`F-${year}-000002`);
    expect((await getDocument(invoice.id)).total).toBe(118);
  });

  it('should charge again when an approved return is undone', async () => {
    const { sales } = await checkout(adminToken, [{ productId: chair, quantity: 1 }]);
    await api().post(`/api/sales/${sales[0]!.id}/returns`).set(auth(adminToken)).send({ quantity: 1, condition: 'resellable' });
    await api().post(`/api/activity/${await entryOf('return.requested')}/undo`).set(auth(adminToken)).send({});

    const invoices = (await api().get('/api/documents?kind=invoice').set(auth(adminToken))).body.data;
    expect(invoices.map((row: { number: string }) => row.number)).toEqual([`F-${year}-000002`, `F-${year}-000001`]);
  });
});

describe('access, printing and the fiscal receipt', () => {
  it('should let employees open only the documents they issued', async () => {
    const own = await checkout(employeeToken, [{ productId: chair, quantity: 1 }]);
    const other = await checkout(adminToken, [{ productId: chair, quantity: 1 }]);

    expect((await api().get(`/api/documents/${own.invoice.id}`).set(auth(employeeToken))).status).toBe(200);
    expect((await api().get(`/api/documents/${other.invoice.id}`).set(auth(employeeToken))).status).toBe(403);
    expect((await api().get('/api/documents').set(auth(employeeToken))).status).toBe(403);
  });

  it('should print an A4 page in the asked language, escaping what people typed', async () => {
    await context.db.updateTable('businesses').set({ name: 'Dacaj <Bros>' }).execute();
    const { invoice } = await checkout(adminToken, [{ productId: chair, quantity: 1 }]);

    const page = await api().get(`/api/documents/${invoice.id}/print?language=sq`).set(auth(adminToken));
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.text).toContain('Faturë');
    expect(page.text).toContain(invoice.number);
    expect(page.text).toContain('Dacaj &lt;Bros&gt;');
    expect(page.text).not.toContain('<Bros>');
    expect(page.text).toContain('size: A4');
    // No logo uploaded: the 4VD mark stands in. No bank account: no payment details.
    expect(page.text).toContain('<span class="logo" aria-hidden="true"><svg');
    expect(page.text).not.toContain('IBAN');
  });

  it('should print the bank account on invoices left on account, but not on paid ones or credit notes', async () => {
    const saved = await api().put('/api/business').set(auth(adminToken)).send({ bankName: 'ProCredit Bank', iban: 'xk05 1212 0123 4567 8906' });
    expect(saved.body.data).toMatchObject({ bankName: 'ProCredit Bank', iban: 'XK051212012345678906' });
    const paid = await checkout(adminToken, [{ productId: bread, quantity: 1 }]);
    expect((await api().get(`/api/documents/${paid.invoice.id}/print`).set(auth(adminToken))).text).not.toContain('XK05');
    const customer = await api().post('/api/customers').set(auth(adminToken)).send({ name: 'Arta', kind: 'person' });
    const { invoice } = await checkout(adminToken, [{ productId: chair, quantity: 1 }], { customerId: customer.body.data.id });

    const page = (await api().get(`/api/documents/${invoice.id}/print?language=en`).set(auth(adminToken))).text;
    expect(page).toContain('ProCredit Bank');
    expect(page).toContain('XK05 1212 0123 4567 8906');

    await api().post(`/api/activity/${await entryOf('sale.recorded')}/undo`).set(auth(adminToken)).send({ note: 'wrong product' });
    const credit = (await api().get('/api/documents?kind=credit_note').set(auth(adminToken))).body.data[0];
    const creditPage = (await api().get(`/api/documents/${credit.id}/print?language=en`).set(auth(adminToken))).text;
    expect(creditPage).toContain('Total to refund');
    expect(creditPage).not.toContain('XK05');
  });

  it("should print each product's code, and keep it on the credit note after the product changes", async () => {
    await context.db.updateTable('products').set({ barcode: '5449000000996', sku: 'CH-1' }).where('id', '=', chair).execute();
    await context.db.updateTable('products').set({ barcode: null, sku: 'BR-1' }).where('id', '=', bread).execute();
    const { invoice } = await checkout(adminToken, [
      { productId: chair, quantity: 1 },
      { productId: bread, quantity: 1 },
    ]);

    // The barcode first, the SKU when there's no barcode.
    expect((await getDocument(invoice.id)).lines.map((line: { productCode: string | null }) => line.productCode)).toEqual(['5449000000996', 'BR-1']);
    expect((await api().get(`/api/documents/${invoice.id}/print`).set(auth(adminToken))).text).toContain('<span class="code">5449000000996</span>');

    await context.db.updateTable('products').set({ barcode: '2000000000015' }).where('id', '=', chair).execute();
    await context.db.updateTable('products').set({ sku: 'BR-2' }).where('id', '=', bread).execute();
    await api().post(`/api/activity/${await entryOf('sale.recorded')}/undo`).set(auth(adminToken)).send({ note: 'wrong product' });
    const credit = (await api().get('/api/documents?kind=credit_note').set(auth(adminToken))).body.data[0];
    const creditLines = (await getDocument(credit.id)).lines.map((line: { productCode: string | null }) => line.productCode);
    // The last sale in the basket, the bread, is the one undone.
    expect(creditLines).toEqual(['BR-1']);
    expect((await getDocument(invoice.id)).lines[0].productCode).toBe('5449000000996');
  });

  it('should refuse an IBAN with a typo, and clear it when emptied', async () => {
    const typo = await api().put('/api/business').set(auth(adminToken)).send({ iban: 'XK05 1212 0123 4567 8907' });
    expect(typo.status).toBe(400);
    await api().put('/api/business').set(auth(adminToken)).send({ iban: 'XK051212012345678906' });
    const cleared = await api().put('/api/business').set(auth(adminToken)).send({ iban: '' });
    expect(cleared.body.data.iban).toBeNull();
  });

  it('should link and unlink the fiscal printer receipt, and nothing else changes', async () => {
    const { invoice } = await checkout(employeeToken, [{ productId: chair, quantity: 1 }]);
    const set = await api().put(`/api/documents/${invoice.id}/fiscal-receipt`).set(auth(employeeToken)).send({ fiscalReceiptNo: ' 000123 ' });
    expect(set.body.data).toMatchObject({ fiscalReceiptNo: '000123', total: 118, number: invoice.number });

    const cleared = await api().put(`/api/documents/${invoice.id}/fiscal-receipt`).set(auth(employeeToken)).send({ fiscalReceiptNo: '' });
    expect(cleared.body.data.fiscalReceiptNo).toBeNull();
  });

  it('should find documents by number or buyer', async () => {
    await checkout(adminToken, [{ productId: chair, quantity: 1 }]);
    const { invoice } = await checkout(adminToken, [{ productId: chair, quantity: 1 }]);
    const found = await api().get(`/api/documents?search=${encodeURIComponent('000002')}`).set(auth(adminToken));
    expect(found.body.data.map((row: { id: number }) => row.id)).toEqual([invoice.id]);
  });
});

describe('rabat, payment and what a full invoice prints', () => {
  it('should take rabat off the price for that quantity and print it, empty where none was given', async () => {
    const { invoice } = await checkout(adminToken, [
      { productId: chair, quantity: 2, discountPercent: 10 },
      { productId: bread, quantity: 1 },
    ]);

    const lines = (await getDocument(invoice.id)).lines;
    // 118 less 10% is 106.20 a chair.
    expect(lines[0]).toMatchObject({ unitPrice: 106.2, discountPercent: 10, priceBeforeDiscount: 118, total: 212.4 });
    expect(lines[1]).toMatchObject({ unitPrice: 1.08, discountPercent: null, priceBeforeDiscount: null });
    const sales = (await api().get('/api/sales').set(auth(adminToken))).body.data.sales;
    expect(sales.find((sale: { productId: number }) => sale.productId === chair)).toMatchObject({ pricePerUnit: 106.2, discountPercent: 10 });

    const page = (await api().get(`/api/documents/${invoice.id}/print?language=sq`).set(auth(adminToken))).text;
    expect(page).toContain('Rabati gjithsej');
    expect(page).toContain('10%');
  });

  it('should let employees give rabat only up to the shop limit; owners and admins any', async () => {
    const tooMuch = await api().post('/api/sales/basket').set(auth(employeeToken)).send({ items: [{ productId: chair, quantity: 1, discountPercent: 15 }] });
    expect(tooMuch.status).toBe(403);
    expect((await api().post('/api/sales/basket').set(auth(employeeToken)).send({ items: [{ productId: chair, quantity: 1, discountPercent: 10 }] })).status).toBe(201);
    await api().put('/api/settings').set(auth(adminToken)).send({ employeeDiscountLimit: 20 });
    expect((await api().post('/api/sales/basket').set(auth(employeeToken)).send({ items: [{ productId: chair, quantity: 1, discountPercent: 15 }] })).status).toBe(201);
    expect((await api().post('/api/sales/basket').set(auth(adminToken)).send({ items: [{ productId: chair, quantity: 1, discountPercent: 50 }] })).status).toBe(201);
  });

  it('should say how each invoice is paid, with a due date after the payment terms for tab sales', async () => {
    const atTill = await checkout(adminToken, [{ productId: bread, quantity: 1 }]);
    expect(await getDocument(atTill.invoice.id)).toMatchObject({ paymentMethod: 'till', dueDate: null });

    await api().put('/api/settings').set(auth(adminToken)).send({ paymentTermsDays: 15 });
    const customer = await api().post('/api/customers').set(auth(adminToken)).send({ name: 'Arta', kind: 'person' });
    const onTab = await checkout(adminToken, [{ productId: bread, quantity: 1 }], { customerId: customer.body.data.id });
    const document = await getDocument(onTab.invoice.id);
    const expected = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(document.paymentMethod).toBe('account');
    // Within a day of 15 days from now (the shop's day can differ from UTC near midnight).
    expect(Math.abs(new Date(document.dueDate).getTime() - new Date(expected).getTime())).toBeLessThanOrEqual(24 * 60 * 60 * 1000);

    const page = (await api().get(`/api/documents/${onTab.invoice.id}/print?language=en`).set(auth(adminToken))).text;
    expect(page).toContain('On account');
    expect(page).toContain('Due by');
  });

  it('should print the number as a barcode, the total in words, the stamp place and the shop note', async () => {
    await api().put('/api/business').set(auth(adminToken)).send({ invoiceNote: 'Thanks for shopping with us!' });
    const { invoice } = await checkout(adminToken, [{ productId: bread, quantity: 1 }]);
    const page = (await api().get(`/api/documents/${invoice.id}/print?language=en`).set(auth(adminToken))).text;
    expect(page).toContain('class="doc__barcode"');
    expect(page).toContain('one euro and eight cents');
    expect(page).toContain('class="stamp"');
    expect(page).toContain('Thanks for shopping with us!');
    expect(page).toContain('Paid at the till');
  });
});
