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

async function checkout(token: string, items: Array<{ productId: number; quantity: number }>, extra: Record<string, unknown> = {}) {
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
    expect(page.text).toContain('size: A4');
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
