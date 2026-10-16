import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importTrefin, parseCsv, type TrefinExport } from '../src/scripts/trefinImport.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
});
afterAll(() => context.db.destroy());

const TZ = 'Europe/Belgrade';

const product = (code: string, barcode: string, name: string, extra: Record<string, string> = {}) => ({
  product_code: code,
  barcode,
  name,
  product_type: 'Mall',
  unit: 'Copë',
  purchase_price_incl_vat: '0.40',
  sale_price_incl_vat: '0.50',
  vat_rate_percent: '18.00',
  current_stock: '12',
  min_stock_level: '',
  last_purchase_date: '2026-07-29',
  ...extra,
});

const line = (receipt: string, code: string, quantity: string, total: string, extra: Record<string, string> = {}) => ({
  receipt_number: receipt,
  doc_type: 'KUP',
  doc_type_description: 'Fiscal receipt (POS sale)',
  sale_date: '2026-10-15',
  sale_time: '18:30:00',
  product_code: code,
  quantity,
  line_total: total,
  unit_price_incl_vat: '0.50',
  unit_cost: '0.33',
  vat_rate_percent: '18.00',
  discount_percent: '',
  customer: 'Bleres te ndryshem',
  payment_method: 'cash',
  ...extra,
});

function sample(): TrefinExport {
  return {
    products: [
      product('339', '3900518300012', 'Golden  Eagle 0.25L'),
      product('679', '5304000011901', 'Marlboro Gold', { current_stock: '-1572', sale_price_incl_vat: '3.60', purchase_price_incl_vat: '3.05' }),
      product('900', '2000000000900', 'Mollë', { unit: 'KG', current_stock: '4.6', sale_price_incl_vat: '1.20' }),
      product('901', '2000000000901', 'Marlboro gold'),
    ],
    suppliers: [
      { code: '700000', name: 'Furnitor te ndryshem', balance_we_owe_them: '0' },
      { code: '700005', name: 'BEL-KOS SH.P.K.', trade_name: '///', nui_unique_id: '810973116', phone: '044/115-249', address: 'Prizren, TIRANA NR.5', balance_we_owe_them: '80000' },
    ],
    customers: [
      { code: '700001', name: 'Bleres te ndryshem', balance_they_owe_us: '0.6' },
      { code: '700110', name: 'Restaurant Vikendi SH.P.K.', nui_unique_id: '811587841', balance_they_owe_us: '1384' },
    ],
    sales: [
      line('K-26-00000001', '339', '2', '1.00'),
      line('K-26-00000001', '679', '1', '3.60', { unit_cost: '101' }),
      line('K-26-00000002', '900', '1.78', '2.14', { unit_price_incl_vat: '1.20' }),
      line('K-26-00000003', '339', '0', '0'),
      // The same receipt number again after TREFIN restarted its numbering, on another day.
      line('K-26-00000001', '339', '1', '0.50', { sale_date: '2023-05-27', sale_time: '' }),
    ],
    duplicates: [{ reason: 'identical name', similarity: '1', code_a: '679', code_b: '901' }],
  };
}

const count = async (table: 'products' | 'sales' | 'suppliers' | 'customers' | 'product_duplicate_flags') =>
  Number((await context.db.selectFrom(table).select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow()).n);

describe('parseCsv', () => {
  it('should read quotes, commas and line breaks inside fields, and drop the BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, ""y""","line\nbreak"\r\n')).toEqual([{ a: 'x, "y"', b: 'line\nbreak' }]);
  });
});

describe('importTrefin', () => {
  it('should check everything on a dry run and change nothing', async () => {
    const report = await importTrefin(context.db, sample(), { apply: false, timeZone: TZ });

    expect(report.applied).toBe(false);
    expect(report.created).toMatchObject({ products: 4, suppliers: 1, customers: 1, sales: 4, checkouts: 3, duplicateFlags: 1 });
    expect(await count('products')).toBe(0);
    expect(await count('sales')).toBe(0);
  });

  it('should import products, stock, partners, sales and duplicate pairs', async () => {
    const report = await importTrefin(context.db, sample(), { apply: true, timeZone: TZ });

    expect(report.notes['sale lines with quantity 0, skipped']).toBe(1);
    const products = await context.db
      .selectFrom('products as p')
      .innerJoin('inventory as i', 'i.product_id', 'p.id')
      .select(['p.sku', 'p.name', 'p.barcode', 'p.base_price', 'p.cost_price', 'p.origin_country', 'p.description', 'i.quantity_on_hand'])
      .orderBy('p.sku')
      .execute();
    expect(products[0]).toMatchObject({ sku: '339', name: 'Golden Eagle 0.25L', base_price: '0.50', cost_price: '0.40', origin_country: 'XK', quantity_on_hand: 12 });
    expect(products[1]).toMatchObject({ sku: '679', quantity_on_hand: 0 });
    expect(products[2]).toMatchObject({ sku: '900', description: 'Unit in TREFIN: KG', quantity_on_hand: 4 });

    const sales = await context.db.selectFrom('sales').select(['receipt_no', 'quantity_sold', 'price_per_unit', 'unit_cost', 'notes', 'sale_date']).orderBy('id').execute();
    expect(sales[0]).toMatchObject({ receipt_no: 'K-26-00000001', quantity_sold: 2, price_per_unit: '0.50', unit_cost: '0.39' });
    // A box price as the line cost is not believable, so the product's purchase price is used.
    expect(sales[1]).toMatchObject({ unit_cost: '3.05' });
    expect(sales[2]).toMatchObject({ quantity_sold: 1, price_per_unit: '2.14', notes: 'Sold 1.78 KG in TREFIN, for €2.14' });
    expect(sales[0]!.sale_date.toISOString()).toBe('2026-10-15T16:30:00.000Z');
    expect(sales[3]!.sale_date.toISOString()).toBe('2023-05-27T10:00:00.000Z');

    const supplier = await context.db.selectFrom('suppliers').selectAll().executeTakeFirstOrThrow();
    expect(supplier).toMatchObject({ name: 'BEL-KOS SH.P.K.', nui: '810973116', phone: '044/115-249' });
    expect(supplier.note).toContain('We owed them €80000.00 in TREFIN');
    expect(await count('customers')).toBe(1);
    expect(await count('product_duplicate_flags')).toBe(1);
  });

  it('should show each imported receipt as one checkout, even when numbers repeat on another day', async () => {
    await importTrefin(context.db, sample(), { apply: true, timeZone: TZ });
    const token = await loginAs(context, 'admin');

    const response = await request(context.app).get('/api/sales/checkouts').set({ Authorization: `Bearer ${token}` });

    const checkouts = response.body.data.checkouts as Array<{ receiptNo: string; total: number; lines: unknown[] }>;
    expect(checkouts.map((checkout) => [checkout.receiptNo, checkout.lines.length, checkout.total])).toEqual([
      ['K-26-00000002', 1, 2.14],
      ['K-26-00000001', 2, 4.6],
      ['K-26-00000001', 1, 0.5],
    ]);
  });

  it('should refuse a shop that already has products, and a second import', async () => {
    const token = await loginAs(context, 'admin');
    await createTestProduct(context, token);
    await expect(importTrefin(context.db, sample(), { apply: true, timeZone: TZ })).rejects.toThrow(/already has 1 products/);

    await resetData(context.db);
    await importTrefin(context.db, sample(), { apply: true, timeZone: TZ });
    await expect(importTrefin(context.db, sample(), { apply: true, timeZone: TZ })).rejects.toThrow(/already imported/);
  });
});
