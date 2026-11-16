import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMonths } from '../src/services/SerialService.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let employeeToken: string;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
  employeeToken = await loginAs(context, 'employee');
});
afterAll(() => context.db.destroy());

const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);
const today = () => new Date().toISOString().slice(0, 10);

async function kettle() {
  await api().put('/api/settings/rules').set(auth()).send({ features: { serials: true } });
  const id = await createTestProduct(context, adminToken, { name: 'Ibrik elektrik', price: 25, costPrice: 15, stock: 5 });
  const marked = await api().put(`/api/serials/products/${id}`).set(auth()).send({ hasSerials: true, warrantyMonths: 24 });
  expect(marked.status).toBe(200);
  return id;
}

describe('warranty end', () => {
  it('adds months, ending on a shorter month’s last day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-16', 24)).toBe('2028-11-16');
  });
});

describe('serial numbers', () => {
  it('records serials coming in, warns about one already in stock, and lets a mistake be removed', async () => {
    const product = await kettle();
    const added = await api().post('/api/serials').set(auth()).send({ productId: product, serials: ['SN-001', 'SN-002', ' sn-001 '] });
    expect(added.body.data).toEqual({ added: 2, alreadyInStock: [] });
    const again = await api().post('/api/serials').set(auth()).send({ productId: product, serials: ['sn-002', 'SN-003'] });
    expect(again.body.data).toEqual({ added: 1, alreadyInStock: ['SN-002'] });
    const list = (await api().get(`/api/serials/products/${product}`).set(auth())).body.data;
    expect(list).toHaveLength(3);
    expect((await api().delete(`/api/serials/${list[0].id}`).set(auth())).status).toBe(200);
  });

  it('needs one serial per unit at the sale, stamps the invoice and warranty, and never sells one twice', async () => {
    const product = await kettle();
    await api().post('/api/serials').set(auth()).send({ productId: product, serials: ['SN-001'] });

    const missing = await api().post('/api/sales/basket').set(auth(employeeToken)).send({ items: [{ productId: product, quantity: 2, serials: ['SN-001'] }] });
    expect(missing.status).toBe(400);
    expect(missing.body.message).toContain('2 serial numbers');

    const sale = await api().post('/api/sales/basket').set(auth(employeeToken)).send({ items: [{ productId: product, quantity: 2, serials: ['sn-001', 'NEW-9'] }] });
    expect(sale.status).toBe(201);
    const invoiceId = sale.body.data.invoice.id as number;

    const found = (await api().get('/api/serials').set(auth(employeeToken)).query({ q: 'new-9' })).body.data;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ serial: 'NEW-9', status: 'sold', productName: 'Ibrik elektrik', invoice: { id: invoiceId }, warrantyEnds: addMonths(today(), 24), underWarranty: true });

    const document = (await api().get(`/api/documents/${invoiceId}`).set(auth())).body.data;
    expect(document.lines[0].serials.map((item: { serial: string }) => item.serial)).toEqual(['SN-001', 'NEW-9']);
    const page = (await api().get(`/api/documents/${invoiceId}/print`).set(auth())).text;
    expect(page).toContain('S/N NEW-9');

    const twice = await api().post('/api/sales/basket').set(auth(employeeToken)).send({ items: [{ productId: product, quantity: 1, serials: ['SN-001'] }] });
    expect(twice.status).toBe(409);
    expect(twice.body.message).toContain('already sold');

    // A return puts the serial back in stock, so it can be sold again.
    await api().post(`/api/sales/${sale.body.data.sales[0].id}/returns`).set(auth()).send({ quantity: 1, condition: 'resellable', refundAmount: 25 });
    const back = (await api().get('/api/serials').set(auth()).query({ q: 'NEW-9' })).body.data[0];
    expect(back).toMatchObject({ status: 'in_stock', invoice: { id: invoiceId } });
    expect(back.returnedAt).not.toBeNull();
    expect((await api().post('/api/sales/basket').set(auth(employeeToken)).send({ items: [{ productId: product, quantity: 1, serials: ['NEW-9'] }] })).status).toBe(201);
  });

  it('asks nothing while switched off or for products without serials', async () => {
    const product = await createTestProduct(context, adminToken, { name: 'Sapun', price: 2, stock: 5 });
    expect((await api().post('/api/sales/basket').set(auth(employeeToken)).send({ items: [{ productId: product, quantity: 1 }] })).status).toBe(201);
    const marked = await kettle();
    await api().put('/api/settings/rules').set(auth()).send({ features: { serials: false } });
    expect((await api().post('/api/sales/basket').set(auth(employeeToken)).send({ items: [{ productId: marked, quantity: 1 }] })).status).toBe(201);
  });
});
