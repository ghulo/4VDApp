import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { matchLine } from '../src/utils/billMatching.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let token: string;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  token = await loginAs(context, 'admin');
});
afterAll(() => context.db.destroy());

const auth = () => ({ Authorization: `Bearer ${token}` });

/** Red Bull with its main barcode; the same can also comes as 90162602 and 5449000000996. */
async function redBull() {
  const id = await createTestProduct(context, token, { name: 'Red Bull 250ml' });
  await request(context.app).put(`/api/products/${id}/barcode`).set(auth()).send({ barcode: '9002490100070' }).expect(200);
  return id;
}

describe('other barcodes', () => {
  it('should find the product by any of its barcodes, when scanned and in search', async () => {
    const id = await redBull();

    const added = await request(context.app).post(`/api/products/${id}/barcodes`).set(auth()).send({ barcode: '90162602' });
    await request(context.app).post(`/api/products/${id}/barcodes`).set(auth()).send({ barcode: '5449000000996' }).expect(200);

    expect(added.status).toBe(200);
    expect(added.body.data).toMatchObject({ barcode: '9002490100070', otherBarcodes: ['90162602'] });
    for (const code of ['9002490100070', '90162602', '5449000000996']) {
      const scanned = await request(context.app).get(`/api/products/barcode/${code}`).set(auth());
      expect(scanned.body.data.id).toBe(id);
    }
    const search = await request(context.app).get('/api/products?search=5449000000996').set(auth());
    expect(search.body.data.map((product: { id: number }) => product.id)).toEqual([id]);
    const log = await context.db.selectFrom('activity_log').select('action').where('action', '=', 'product.barcode_added').execute();
    expect(log).toHaveLength(2);
  });

  it('should refuse a barcode this or another product already has, and a bad check digit', async () => {
    const id = await redBull();
    const other = await createTestProduct(context, token, { name: 'Coca Cola' });
    await request(context.app).post(`/api/products/${id}/barcodes`).set(auth()).send({ barcode: '90162602' }).expect(200);

    const own = await request(context.app).post(`/api/products/${id}/barcodes`).set(auth()).send({ barcode: '9002490100070' });
    const taken = await request(context.app).post(`/api/products/${other}/barcodes`).set(auth()).send({ barcode: '90162602' });
    const takenAsMain = await request(context.app).put(`/api/products/${other}/barcode`).set(auth()).send({ barcode: '90162602' });
    const typo = await request(context.app).post(`/api/products/${id}/barcodes`).set(auth()).send({ barcode: '5449000000997' });

    expect([own.status, taken.status, takenAsMain.status, typo.status]).toEqual([409, 409, 409, 400]);
  });

  it('should take the first barcode as the main one when the product has none', async () => {
    const id = await createTestProduct(context, token, { name: 'Red Bull 250ml' });

    const response = await request(context.app).post(`/api/products/${id}/barcodes`).set(auth()).send({ barcode: '90162602' });

    expect(response.body.data).toMatchObject({ barcode: '90162602', otherBarcodes: [] });
  });

  it('should swap places when another barcode is made the main one, and remove one', async () => {
    const id = await redBull();
    await request(context.app).post(`/api/products/${id}/barcodes`).set(auth()).send({ barcode: '90162602' }).expect(200);

    const swapped = await request(context.app).put(`/api/products/${id}/barcode`).set(auth()).send({ barcode: '90162602' });
    expect(swapped.body.data).toMatchObject({ barcode: '90162602', otherBarcodes: ['9002490100070'] });

    const removed = await request(context.app).delete(`/api/products/${id}/barcodes/9002490100070`).set(auth());
    expect(removed.body.data).toMatchObject({ barcode: '90162602', otherBarcodes: [] });
    const missing = await request(context.app).delete(`/api/products/${id}/barcodes/9002490100070`).set(auth());
    expect(missing.status).toBe(404);
    const scanned = await request(context.app).get('/api/products/barcode/9002490100070').set(auth());
    expect(scanned.status).toBe(404);
  });

  it('should free the barcodes of a deleted product for another one', async () => {
    const id = await redBull();
    await request(context.app).post(`/api/products/${id}/barcodes`).set(auth()).send({ barcode: '90162602' }).expect(200);
    await request(context.app).delete(`/api/products/${id}`).set(auth()).expect(200);
    const other = await createTestProduct(context, token, { name: 'Red Bull 250ml (new)' });
    await request(context.app).put(`/api/products/${other}/barcode`).set(auth()).send({ barcode: '9002490100070' }).expect(200);

    const response = await request(context.app).post(`/api/products/${other}/barcodes`).set(auth()).send({ barcode: '90162602' });

    expect(response.status).toBe(200);
    expect(response.body.data.otherBarcodes).toEqual(['90162602']);
  });

  it('should match a bill line by another barcode without calling it a different barcode', () => {
    const product = { id: 1, name: 'Red Bull 250ml', sku: null, barcode: '9002490100070', otherBarcodes: ['90162602'], costPrice: 1, vatRate: 18 };
    const reading = { pricesIncludeVat: false } as Parameters<typeof matchLine>[1];
    const line = { name: 'RB energy', barcode: '90162602', code: null, quantity: 24, unitPrice: 1, unitsPerPack: null } as unknown as Parameters<typeof matchLine>[0];

    const match = matchLine(line, reading, [product], new Map());

    expect(match).toMatchObject({ productId: 1, matchedBy: 'barcode', oldBarcode: null });
    expect(match.stamp).not.toBe('barcode');
  });
});

describe('pack barcodes', () => {
  const api = () => request(context.app);

  it('adds a pack barcode whose price becomes the bulk price for that many, and sells it', async () => {
    const id = await redBull();
    await api().put(`/api/products/${id}`).set(auth()).send({ name: 'Red Bull 250ml', categoryId: (await api().get(`/api/products/${id}`).set(auth())).body.data.category.id, price: 1.5 }).expect(200);

    const uneven = await api().post(`/api/products/${id}/barcodes`).set(auth()).send({ barcode: '5449000000996', packSize: 6, packPrice: 8 });
    expect(uneven.status).toBe(400);
    expect(JSON.stringify(uneven.body)).toContain('7.98 or 8.04');
    const tooDear = await api().post(`/api/products/${id}/barcodes`).set(auth()).send({ barcode: '5449000000996', packSize: 6, packPrice: 9.6 });
    expect(tooDear.status).toBe(400);

    const added = await api().post(`/api/products/${id}/barcodes`).set(auth()).send({ barcode: '5449000000996', packSize: 6, packPrice: 8.04 });
    expect(added.status).toBe(200);
    expect(added.body.data).toMatchObject({ otherBarcodes: ['5449000000996'], packs: [{ barcode: '5449000000996', size: 6 }], bulkPricingTiers: [{ quantity: 6, price: 1.34 }] });

    const shelf = (await api().get('/api/counter/shelf').set(auth())).body.data;
    expect(shelf.find((one: { id: number }) => one.id === id).packs).toEqual([{ barcode: '5449000000996', size: 6 }]);
    const sale = await api().post('/api/sales/basket').set(auth()).send({ items: [{ productId: id, quantity: 6 }], notes: null });
    expect(sale.status).toBe(201);
    expect(sale.body.data.total).toBe(8.04);
  });

  it("keeps a pack barcode off the main place and off products sold by measure", async () => {
    const id = await redBull();
    await api().post(`/api/products/${id}/barcodes`).set(auth()).send({ barcode: '5449000000996', packSize: 24 }).expect(200);
    expect((await api().put(`/api/products/${id}/barcode`).set(auth()).send({ barcode: '5449000000996' })).status).toBe(400);

    const product = (await api().get(`/api/products/${id}`).set(auth())).body.data;
    const toKilo = await api().put(`/api/products/${id}`).set(auth()).send({ name: product.name, categoryId: product.category.id, price: product.price, unit: 'kg' });
    expect(toKilo.status).toBe(400);

    const cheese = await createTestProduct(context, token, { name: 'Djathë', unit: 'kg' });
    await api().put(`/api/products/${cheese}/barcode`).set(auth()).send({ barcode: '4006381333931' }).expect(200);
    expect((await api().post(`/api/products/${cheese}/barcodes`).set(auth()).send({ barcode: '9780201379624', packSize: 6 })).status).toBe(400);
  });

  it('counts a bill line found by a pack barcode in packs', () => {
    const product = { id: 1, name: 'Red Bull 250ml', sku: null, barcode: '9002490100070', otherBarcodes: ['5449000000996'], packs: [{ barcode: '5449000000996', size: 24 }], costPrice: 1, vatRate: 18 };
    const reading = { pricesIncludeVat: false } as Parameters<typeof matchLine>[1];
    const line = { name: 'RB tray', barcode: '5449000000996', code: null, quantity: 2, unitPrice: 24, unitsPerPack: null } as unknown as Parameters<typeof matchLine>[0];

    expect(matchLine(line, reading, [product], new Map())).toMatchObject({ productId: 1, unitsPerPack: 24, pieces: 48, unitCost: 1 });
  });
});
