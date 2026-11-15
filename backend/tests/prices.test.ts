import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nicePrice, priceFromCost, markupOf } from '../src/services/pricing/priceRules.js';
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

const api = () => request(context.app);
const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });

describe('price rules', () => {
  it('works out a price from cost with a mark-up, exact or rounded to a usual price', () => {
    expect(priceFromCost(1, 25, 'exact')).toBe(1.25);
    expect(priceFromCost(1, 25, 'nice')).toBe(1.29);
    expect(priceFromCost(20.2, 25, 'nice')).toBe(25.49);
    expect(nicePrice(1.4)).toBe(1.44);
    expect(markupOf(1.25, 1)).toBe(25);
    expect(markupOf(1.25, null)).toBeNull();
  });
});

describe('the Prices page', () => {
  it('plans changes without saving, then saves them with a history entry each', async () => {
    const juice = await createTestProduct(context, adminToken, { name: 'Lëng 1L', price: 2, costPrice: 1.2 });
    const plan = await api().post('/api/products/prices/plan').set(auth()).send({ changes: [{ productId: juice, price: 1.1, wholesalePrice: 1.5 }] });
    expect(plan.status).toBe(200);
    expect(plan.body.data.changes[0]).toMatchObject({ price: { from: 2, to: 1.1 }, wholesalePrice: { from: null, to: 1.5 }, warnings: expect.arrayContaining(['belowCost', 'wholesaleAboveShelf']) });
    expect((await api().get(`/api/products/${juice}`).set(auth())).body.data.price).toBe(2);

    const saved = await api().post('/api/products/prices').set(auth()).send({ changes: [{ productId: juice, price: 2.2, wholesalePrice: 1.8 }], source: 'editor' });
    expect(saved.body.data).toEqual({ changed: 1 });
    const product = (await api().get(`/api/products/${juice}`).set(auth())).body.data;
    expect(product).toMatchObject({ price: 2.2, wholesalePrice: 1.8 });
    const history = (await api().get(`/api/products/${juice}/price-history`).set(auth())).body.data;
    expect(history[0].price).toEqual({ from: 2, to: 2.2 });
    // Staff don't change prices.
    expect((await api().get('/api/products/prices').set(auth(employeeToken))).status).toBe(403);
  });

  it('refuses a shelf price at or under a bulk price, and saves nothing then', async () => {
    const water = await createTestProduct(context, adminToken, { name: 'Ujë 0.5L', price: 0.5, costPrice: 0.2, bulkPricingTiers: [{ quantity: 6, price: 0.4 }] });
    const juice = await createTestProduct(context, adminToken, { name: 'Lëng 1L', price: 2, costPrice: 1.2 });
    const plan = (await api().post('/api/products/prices/plan').set(auth()).send({ changes: [{ productId: water, price: 0.4 }] })).body.data;
    expect(plan.changes[0].problems).toEqual(['bulkAbove']);
    const saved = await api().post('/api/products/prices').set(auth()).send({ changes: [{ productId: juice, price: 3 }, { productId: water, price: 0.4 }] });
    expect(saved.status).toBe(400);
    expect((await api().get(`/api/products/${juice}`).set(auth())).body.data.price).toBe(2);
  });

  it('sets shelf prices from cost, leaving out products with no cost', async () => {
    const juice = await createTestProduct(context, adminToken, { name: 'Lëng 1L', price: 2, costPrice: 1.2 });
    await createTestProduct(context, adminToken, { name: 'Pa kosto', price: 3, costPrice: null });
    const plan = (await api().post('/api/products/prices/from-cost').set(auth()).send({ level: 'shelf', markupPercent: 50, rounding: 'nice' })).body.data;
    expect(plan.noCost).toBe(1);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({ productId: juice, price: { from: 2, to: 1.84 }, markup: { price: 53.33 } });
  });

  it('reads back the price file it downloads, matching by barcode, code or name', async () => {
    const juice = await createTestProduct(context, adminToken, { name: 'Lëng 1L', price: 2, costPrice: 1.2, sku: 'L1' });
    const cola = await createTestProduct(context, adminToken, { name: 'Coca-Cola 0.5L', price: 1, costPrice: 0.6 });
    await api().put(`/api/products/${cola}/barcode`).set(auth()).send({ barcode: '5449000000996' });

    const download = await api().get('/api/exports/prices.xlsx').set(auth()).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
    expect(download.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(download.body as never);
    const sheet = workbook.worksheets[0]!;
    let headerRow = 0;
    sheet.eachRow((row, number) => {
      if (headerRow === 0 && row.values && (row.values as unknown[]).includes('Shelf price')) headerRow = number;
    });
    expect(headerRow).toBeGreaterThan(0);

    // A file someone typed: Albanian headers, one unknown product, one bad price.
    const typed = new ExcelJS.Workbook();
    const page = typed.addWorksheet('Çmimet');
    page.addRow(['Barkodi', 'Kodi', 'Produkti', 'Çmimi me shumicë', 'Çmimi në raft']);
    page.addRow(['5449000000996', '', 'Coca Cola', 0.85, 1.1]);
    page.addRow(['', 'L1', '', '', '2,30']);
    page.addRow(['', '', 'Nuk ekziston', '', 5]);
    page.addRow(['', '', 'Coca-Cola 0.5L', 'abc', '']);
    const file = Buffer.from(await typed.xlsx.writeBuffer()).toString('base64');
    const read = await api().post('/api/products/prices/file').set(auth()).send({ fileName: 'cmimet.xlsx', data: file });
    expect(read.status).toBe(200);
    expect(read.body.data.notFound).toEqual([{ row: 4, text: 'Nuk ekziston' }]);
    expect(read.body.data.unreadable).toEqual([{ row: 5, text: 'Coca-Cola 0.5L' }]);
    const byId = new Map(read.body.data.changes.map((change: { productId: number }) => [change.productId, change]));
    expect(byId.get(cola)).toMatchObject({ price: { from: 1, to: 1.1 }, wholesalePrice: { from: null, to: 0.85 } });
    expect(byId.get(juice)).toMatchObject({ price: { from: 2, to: 2.3 } });
  });

  it('downloads a price list at wholesale prices, never above the shelf price', async () => {
    await createTestProduct(context, adminToken, { name: 'Lëng 1L', price: 2, wholesalePrice: 2.5 });
    const list = await api().get('/api/exports/price-list.csv').query({ level: 'wholesale', lang: 'sq' }).set(auth());
    expect(list.status).toBe(200);
    expect(list.text).toContain('Çmimi me shumicë');
    expect(list.text).toContain('Lëng 1L');
    expect(list.text).toMatch(/2\.00|2(?!\.5)/);
  });
});
