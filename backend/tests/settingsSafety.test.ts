import request from 'supertest';
import sharp from 'sharp';
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
  productId = await createTestProduct(context, adminToken, { price: 10, costPrice: 6, stock: 5, vatRate: 18 });
});
afterAll(() => context.db.destroy());

const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);
const year = new Date().getFullYear();
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });
const png = () => sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

function sell(quantity: number, token = adminToken) {
  return api().post('/api/sales/basket').set(auth(token)).send({ items: [{ productId, quantity }] });
}

describe('numbering', () => {
  it('should number the next invoice, credit note and offer the way the shop set, and keep counting', async () => {
    expect((await sell(1)).body.data.invoice.number).toBe(`F-${year}-000001`);
    const saved = await api()
      .put('/api/settings/rules')
      .set(auth())
      .send({ numbering: { invoice: { prefix: 'fsm', year: 'yy', digits: 5 }, offer: { prefix: 'OFR', year: 'yyyy', digits: 4 } } });
    expect(saved.status).toBe(200);
    expect(saved.body.data.numbering.invoice).toEqual({ prefix: 'FSM', year: 'yy', digits: 5 });
    expect(saved.body.data.numbering.credit_note.prefix).toBe('K');

    expect((await sell(1)).body.data.invoice.number).toBe(`FSM-${String(year % 100)}-00002`);
    const offer = await api().post('/api/offers').set(auth()).send({ partyName: 'Kafe', lines: [{ productId, quantity: 1, unitPrice: 9 }] });
    expect(offer.status).toBe(201);
    expect(offer.body.data.number).toBe(`OFR-${year}-0001`);
    expect((await api().get('/api/counter/today').set(auth())).body.data.nextReceipt).toBe(`FSM-${String(year % 100)}-00003`);
  });

  it('should refuse two kinds with the same prefix, and let only managers change it', async () => {
    const clash = await api().put('/api/settings/rules').set(auth()).send({ numbering: { credit_note: { prefix: 'F', year: 'yyyy', digits: 6 } } });
    expect(clash.status).toBe(400);
    expect((await api().put('/api/settings/rules').set(auth(employeeToken)).send({ noStockSales: 'allow' })).status).toBe(403);
    expect((await api().get('/api/settings/rules').set(auth(employeeToken))).status).toBe(200);
  });
});

describe('selling with no stock', () => {
  it('should refuse an employee past the stock, let the owner side sell, and allow everyone when switched on', async () => {
    expect((await sell(7, employeeToken)).status).toBe(400);
    // An admin sells past it; stock goes to 0 and a count is asked for.
    expect((await sell(6)).status).toBe(201);
    const stock = await context.db.selectFrom('inventory').select('quantity_on_hand').where('product_id', '=', productId).executeTakeFirstOrThrow();
    expect(Number(stock.quantity_on_hand)).toBe(0);

    await api().put('/api/settings/rules').set(auth()).send({ noStockSales: 'allow' });
    expect((await sell(2, employeeToken)).status).toBe(201);
  });
});

describe('stamp and signature', () => {
  it('should print the stamp and signature on the invoice once they are added', async () => {
    const invoice = (await sell(1)).body.data.invoice.id;
    const before = await api().get(`/api/documents/${invoice}/print`).set(auth());
    expect(before.text).not.toContain('class="stamp stamp--printed"');

    const stamp = await api().put('/api/business/pictures/stamp').set(auth()).set('Content-Type', 'image/png').send(await png());
    expect(stamp.status).toBe(200);
    expect(stamp.body.data.stampUrl).toMatch(/\/api\/media\//);
    await api().put('/api/business/pictures/signature').set(auth()).set('Content-Type', 'image/png').send(await png());
    expect((await api().put('/api/business/pictures/logo2').set(auth()).set('Content-Type', 'image/png').send(await png())).status).toBe(404);
    expect((await api().put('/api/business/pictures/stamp').set(auth(employeeToken)).set('Content-Type', 'image/png').send(await png())).status).toBe(403);

    const after = await api().get(`/api/documents/${invoice}/print`).set(auth());
    expect(after.text).toContain('class="stamp stamp--printed"');
    expect(after.text).toContain('class="signature__ink"');

    expect((await api().delete('/api/business/pictures/stamp').set(auth())).body.data.stampUrl).toBeNull();
  });
});

describe('files and the recycle bin', () => {
  it('should keep files on a record, move a removed one to the bin and bring it back', async () => {
    const supplier = (await api().post('/api/suppliers').set(auth()).send({ name: 'Fresh Foods', nui: '811234560' })).body.data.id;
    const added = await api().post(`/api/files/supplier/${supplier}`).set(auth()).set('Content-Type', 'application/pdf').set('X-File-Name', encodeURIComponent('kontrata 2026.pdf')).send(pdf);
    expect(added.status).toBe(201);
    expect(added.body.data).toMatchObject({ name: 'kontrata 2026.pdf', mime: 'application/pdf' });
    const photo = await api().post(`/api/files/supplier/${supplier}`).set(auth()).set('Content-Type', 'image/png').set('X-File-Name', 'note.png').send(await png());
    expect(photo.body.data).toMatchObject({ name: 'note.webp', mime: 'image/webp' });

    expect((await api().post('/api/files/supplier/9999').set(auth()).set('Content-Type', 'application/pdf').send(pdf)).status).toBe(404);
    // An employee can't open a supplier, so not its files either.
    expect((await api().get(`/api/files/supplier/${supplier}`).set(auth(employeeToken))).status).toBe(403);

    expect((await api().delete(`/api/files/${added.body.data.id}`).set(auth())).status).toBe(200);
    expect((await api().get(`/api/files/supplier/${supplier}`).set(auth())).body.data).toHaveLength(1);
    const bin = (await api().get('/api/bin').set(auth())).body.data;
    expect(bin).toEqual([expect.objectContaining({ kind: 'file', id: added.body.data.id, name: 'kontrata 2026.pdf' })]);

    expect((await api().post(`/api/bin/file/${added.body.data.id}/restore`).set(auth())).status).toBe(200);
    expect((await api().get(`/api/files/supplier/${supplier}`).set(auth())).body.data).toHaveLength(2);
    expect((await api().get('/api/bin').set(auth())).body.data).toEqual([]);
  });

  it('should delete files that sat in the bin for 90 days', async () => {
    const supplier = (await api().post('/api/suppliers').set(auth()).send({ name: 'Old', nui: '811234561' })).body.data.id;
    const added = (await api().post(`/api/files/supplier/${supplier}`).set(auth()).set('Content-Type', 'application/pdf').send(pdf)).body.data;
    await context.db.updateTable('attachments').set({ removed_at: new Date(Date.now() - 91 * 86_400_000) }).where('id', '=', added.id).execute();
    expect(await context.container.attachmentService.purge()).toBe(1);
    expect(await context.db.selectFrom('media').select('id').where('id', '=', added.url.split('/').pop()).executeTakeFirst()).toBeUndefined();
  });

  it('should list removed products, suppliers, customers and expenses and put each back', async () => {
    const supplier = (await api().post('/api/suppliers').set(auth()).send({ name: 'Gone Ltd', nui: '811234562' })).body.data.id;
    const customer = (await api().post('/api/customers').set(auth()).send({ name: 'Arben' })).body.data.id;
    const expense = (await api().post('/api/expenses').set(auth()).send({ day: today(), amount: 15, category: 'cleaning', place: 'shop' })).body.data.id;
    expect((await api().delete(`/api/products/${productId}`).set(auth())).status).toBe(200);
    expect((await api().delete(`/api/suppliers/${supplier}`).set(auth())).status).toBe(200);
    expect((await api().post(`/api/customers/${customer}/archive`).set(auth())).status).toBe(200);
    expect((await api().delete(`/api/expenses/${expense}`).set(auth())).status).toBe(200);

    const bin = (await api().get('/api/bin').set(auth())).body.data as Array<{ kind: string; id: number }>;
    expect(bin.map((item) => item.kind).sort()).toEqual(['customer', 'expense', 'product', 'supplier']);
    expect((await api().get('/api/bin').set(auth(employeeToken))).status).toBe(403);

    for (const item of bin) expect((await api().post(`/api/bin/${item.kind}/${item.id}/restore`).set(auth())).status).toBe(200);
    expect((await api().get('/api/bin').set(auth())).body.data).toEqual([]);
    expect((await api().get(`/api/products/${productId}`).set(auth())).status).toBe(200);
    const expenses = (await api().get(`/api/expenses?startDate=${today()}&endDate=${today()}`).set(auth())).body.data;
    expect(JSON.stringify(expenses)).toContain('cleaning');
    expect((await api().post(`/api/bin/product/${productId}/restore`).set(auth())).status).toBe(404);
  });
});
