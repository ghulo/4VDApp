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
    categories: new Map([
      ['339', 'Pije energjike'],
      ['679', 'Cigare dhe duhan'],
      ['901', 'Cigare dhe duhan'],
    ]),
  };
}

const EACH = { MARKET_2025: [], MARKET_2022: [], MARKET_2022_FINAL_2023_05_26: [] };
const noSalesHistory = { saleInvoices: EACH, deletedSales: EACH, deletedSaleLines: EACH };
const noStockHistory = { stockMoves: EACH, stockCounts: EACH };
const emptyHistory = () => ({
  partners: EACH,
  products: { MARKET_2025: new Map(), MARKET_2022: new Map(), MARKET_2022_FINAL_2023_05_26: new Map() },
  bills: EACH,
  billLines: [],
  deletedBills: EACH,
  deletedBillLines: EACH,
  deleteLog: EACH,
  ...noSalesHistory,
  ...noStockHistory,
});

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
    expect(report.created).toMatchObject({ categories: 3, products: 4, suppliers: 1, customers: 1, sales: 4, checkouts: 3, duplicateFlags: 1 });
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
    const categories = await context.db
      .selectFrom('products as p')
      .innerJoin('categories as c', 'c.id', 'p.category_id')
      .select(['p.sku', 'c.name'])
      .orderBy('p.sku')
      .execute();
    expect(categories.map((row) => row.name)).toEqual(['Pije energjike', 'Cigare dhe duhan', 'Të ndryshme', 'Cigare dhe duhan']);

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

  it("should bring in TREFIN's purchases as look-only bills, partners from every database and reused codes as old products", async () => {
    const data = sample();
    data.products[0]!.invoice_price_incl_vat = '0.45';
    data.products[1]!.invoice_price_incl_vat = '3.60';
    const partner = (code: string, name: string, extra: Record<string, string> = {}) => ({
      NrKlient: code, NrID: '6', EmerKlient: name, NRB: '71159213', NRF: '601254171', NRTVSH: '0', Qyteti: 'Prizren', Adresa: 'Rr. Tirana 5',
      Furnitor: 'True', Klient: 'False', Bank: 'False', Tel: '044/115-249', Mobil: '049 111 222', eMail: '', Kontakt: 'Arben', Limit: '0', Rabati: '0',
      NRU: '810973116', EmerTregtar: '///', LlogariaBankare: 'XK05 1212 0123 4567 8906', ...extra,
    });
    const header = (id: string, number: string, day: string, supplier: string, total: string, extra: Record<string, string> = {}) => ({
      NrRen: id, NrFatura: number, Data: `${day} 00:00:00`, LlojDok: 'FBM', NrKlient: supplier, Totali: total, TVSH: '0.36', PagesaPoJo: 'True', PagesaShuma: total, ...extra,
    });
    const purchase = (db: string, id: string, code: string, quantity: string, net: string, extra: Record<string, string> = {}) => ({
      source_db: db, doc_id: id, document_number: `F-${id}`, doc_type: 'FBM', purchase_date: '2024-05-02', supplier_code: '700005', supplier: 'BEL-KOS SH.P.K.',
      product_code: code, barcode: '', product_name: '', unit: 'Copë', quantity, unit_cost_excl_vat: '0.20', vat_rate_percent: '18.00', vat_amount: '0.36', net_amount: net, line_total: '2.36', ...extra,
    });
    data.history = {
      partners: {
        MARKET_2025: [partner('700005', 'BEL-KOS SH.P.K.')],
        // The same business under another code in an older database, and a supplier only that database knew.
        MARKET_2022: [partner('700031', 'Bel-Kos shpk'), partner('700040', 'Old Bakery', { NRU: '811111111', NRB: '0', NRF: '0', LlogariaBankare: '' })],
        MARKET_2022_FINAL_2023_05_26: [],
      },
      products: {
        MARKET_2025: new Map(),
        MARKET_2022: new Map([['339', { barcode: '8600000000001', name: 'Twix 50g' }]]),
        MARKET_2022_FINAL_2023_05_26: new Map(),
      },
      bills: {
        MARKET_2025: [header('10', 'F-10', '2025-04-08', '700005', '2.36')],
        MARKET_2022: [header('20', 'F-20', '2024-05-02', '700031', '2.36', { PagesaPoJo: 'False' }), header('21', 'KB-1', '2024-05-03', '700040', '1.18', { LlojDok: 'KB' })],
        MARKET_2022_FINAL_2023_05_26: [],
      },
      billLines: [
        purchase('MARKET_2025', '10', '339', '10', '2.00'),
        purchase('MARKET_2025', '10', '679', '0', '0'),
        // Code 339 was Twix in MARKET_2022; 901 still had Marlboro Gold's barcode there.
        purchase('MARKET_2022', '20', '339', '4', '0.80', { barcode: '8600000000001', product_name: 'Twix 50g', supplier_code: '700031' }),
        purchase('MARKET_2022', '20', '901', '1', '3.00', { barcode: '5304000011901', product_name: 'Marlboro (old name)', supplier_code: '700031' }),
        purchase('MARKET_2022', '21', '900', '-1.5', '-1.00', { doc_type: 'KB', document_number: 'KB-1', supplier_code: '700040', unit: 'KG' }),
      ],
      deletedBills: { MARKET_2025: [header('30', 'F-30', '2025-06-01', '700005', '5.00')], MARKET_2022: [], MARKET_2022_FINAL_2023_05_26: [] },
      deletedBillLines: { MARKET_2025: [{ NrRen: '30', NrArt: '339', Sasia: '2', Cmimi: '2.12', Vlera: '4.24', TVSH: '0.76' }], MARKET_2022: [], MARKET_2022_FINAL_2023_05_26: [] },
      deleteLog: { MARKET_2025: [{ NrRen: '30', LlojDok: 'FBM', DataDelete: '2025-06-02 09:15:00', EmerUser: 'Administratori', EmerKlient: 'BEL-KOS SH.P.K.' }], MARKET_2022: [], MARKET_2022_FINAL_2023_05_26: [] },
      ...noSalesHistory,
      ...noStockHistory,
    };
    data.sales.push(line('K-23-00000009', '339', '1', '1.00', { source_db: 'MARKET_2022', barcode: '8600000000001', product_name: 'Twix 50g', sale_date: '2024-05-04' }));

    const report = await importTrefin(context.db, data, { apply: true, timeZone: TZ });

    expect(report.created).toMatchObject({ suppliers: 2, oldProducts: 1, bills: 4, billLines: 5, deletedBills: 1 });
    const suppliers = await context.db.selectFrom('suppliers').selectAll().orderBy('id').execute();
    expect(suppliers.map((row) => row.name)).toEqual(['BEL-KOS SH.P.K.', 'Old Bakery']);
    expect(suppliers[0]).toMatchObject({
      external_code: '700005', business_no: '71159213', fiscal_no: '601254171', city: 'Prizren', address: 'Prizren, TIRANA NR.5', iban: 'XK05 1212 0123 4567 8906', contact_person: 'Arben', mobile: '049 111 222',
    });
    const wholesale = await context.db.selectFrom('products').select(['sku', 'wholesale_price']).where('sku', 'in', ['339', '679']).orderBy('sku').execute();
    expect(wholesale.map((row) => row.wholesale_price)).toEqual(['0.45', null]);
    const old = await context.db.selectFrom('products').selectAll().where('name', '=', 'Twix 50g').executeTakeFirstOrThrow();
    expect(old).toMatchObject({ is_active: false, sku: null, barcode: '8600000000001' });
    const twixSale = await context.db.selectFrom('sales').select('product_id').where('receipt_no', '=', 'K-23-00000009').executeTakeFirstOrThrow();
    expect(twixSale.product_id).toBe(old.id);

    const token = await loginAs(context, 'admin');
    const auth = { Authorization: `Bearer ${token}` };
    const history = (await request(context.app).get('/api/bills?source=trefin').set(auth)).body.data as Array<Record<string, unknown> & { lines: Array<Record<string, unknown>> }>;
    expect(history.map((bill) => [bill.number, bill.kind, bill.status, bill.left, bill.fromTrefin])).toEqual([
      ['F-10', 'bill', 'history', 0, true],
      ['KB-1', 'credit', 'history', 0, true],
      ['F-20', 'bill', 'history', 0, true],
      ['F-30', 'bill', 'void', 0, true],
    ]);
    const f20 = history.find((bill) => bill.number === 'F-20')!;
    expect(f20.supplier).toMatchObject({ name: 'BEL-KOS SH.P.K.' });
    expect(f20.note).toContain('Not marked paid in TREFIN');
    expect(f20.lines.map((row) => [row.productName, row.quantity])).toEqual([
      ['Twix 50g', 4],
      ['Marlboro Gold', 1],
    ]);
    const credit = history.find((bill) => bill.number === 'KB-1')!;
    expect(credit.lines[0]).toMatchObject({ quantity: 1, net: 1, description: '1.5 KG in TREFIN' });
    expect(history[3]!.voidNote).toBe('Deleted in TREFIN by Administratori');

    // Never owed, never paid or changed here, and not in the stock.
    expect((await request(context.app).get('/api/bills?status=open').set(auth)).body.data).toEqual([]);
    expect((await request(context.app).get('/api/bills?source=4vd').set(auth)).body.data).toEqual([]);
    const pay = await request(context.app).post(`/api/bills/${String(f20.id)}/payments`).set(auth).send({ amount: 1, paidOn: '2024-06-01', method: 'cash' });
    expect(pay.status).toBe(409);
    const stock = await context.db.selectFrom('inventory as i').innerJoin('products as p', 'p.id', 'i.product_id').select('i.quantity_on_hand').where('p.sku', '=', '339').executeTakeFirstOrThrow();
    expect(stock.quantity_on_hand).toBe(12);

    const imported = await request(context.app).get('/api/sales/checkouts?source=4vd').set(auth);
    expect(imported.body.data.checkouts).toEqual([]);
  });

  it("should make TREFIN's invoices look-only invoices and list its deleted receipts in the counter report", async () => {
    const data = sample();
    data.customers.push({ code: '700108', name: 'G Pastrimi SH.P.K.', nui_unique_id: '811111112', balance_they_owe_us: '0' });
    const invoiceLine = (number: string, code: string, quantity: string, total: string) =>
      line(number, code, quantity, total, { source_db: 'MARKET_2025', doc_type: 'FSM', doc_type_description: 'Sales invoice', customer: 'G Pastrimi SH.P.K.', payment_method: 'on account (invoice)', sale_date: '2025-04-18', sale_time: '10:00:00' });
    data.sales.push(invoiceLine('FSM-25-000002', '339', '4', '2.00'), invoiceLine('FSM-25-000002', '679', '1', '3.60'));
    data.sales.push(line('K-26-00000010', '339', '1', '0.50', { payment_method: 'bank/card' }));
    const history = emptyHistory();
    data.history = {
      ...history,
      products: { ...history.products, MARKET_2022: new Map([['339', { barcode: '', name: 'Golden Eagle (old)' }]]) },
      saleInvoices: { ...EACH, MARKET_2025: [{ NrRen: '55', NrFatura: 'FSM-25-000002', LlojDok: 'FSM', NrKlient: '700108', PagesaPoJo: 'False', PagesaShuma: '0' }] },
      // MARKET_2025 kept a copy of MARKET_2022's deletion: it is taken once.
      deletedSales: {
        ...EACH,
        MARKET_2025: [{ NrRen: '900', NrFatura: 'K-23-00000819', Data: '2023-06-06 00:00:00', LlojDok: 'KUP', NrKlient: '700001', Totali: '2.6' }],
        MARKET_2022: [{ NrRen: '23320', NrFatura: 'K-23-00000819', Data: '2023-06-06 00:00:00', LlojDok: 'KUP', NrKlient: '700001', Totali: '2.6' }],
      },
      deletedSaleLines: { ...EACH, MARKET_2022: [{ NrRen: '23320', NrArt: '339', Sasia: '2', Totali: '2.6' }] },
      deleteLog: { ...EACH, MARKET_2022: [{ NrRen: '23320', LlojDok: 'KUP', DataDelete: '2023-06-06 17:20:00', EmerUser: 'Administratori', EmerKlient: 'Bleres te ndryshem' }] },
    };

    const report = await importTrefin(context.db, data, { apply: true, timeZone: TZ });

    expect(report.created).toMatchObject({ invoices: 1, deletedReceipts: 1 });
    const token = await loginAs(context, 'admin');
    const auth = { Authorization: `Bearer ${token}` };
    const documents = (await request(context.app).get('/api/documents?source=trefin').set(auth)).body.data as Array<Record<string, unknown>>;
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({ number: 'FSM-25-000002', fromTrefin: true, total: 5.6, paymentMethod: 'account', dueDate: null });
    expect(documents[0]!.reason).toBe('From TREFIN: sales invoice in its books from Mar 2025 on. Not marked paid in TREFIN.');
    expect(documents[0]!.buyer).toMatchObject({ name: 'G Pastrimi SH.P.K.', nui: '811111112' });
    expect((await request(context.app).get('/api/documents?source=4vd').set(auth)).body.data).toEqual([]);
    const id = documents[0]!.id as number;
    const detail = (await request(context.app).get(`/api/documents/${id}`).set(auth)).body.data as { lines: Array<Record<string, unknown>> };
    expect(detail.lines.map((row) => [row.productName, row.quantity, row.vatRate, row.total])).toEqual([
      ['Golden Eagle 0.25L', 4, 18, 2],
      ['Marlboro Gold', 1, 18, 3.6],
    ]);
    // Never changed here, nothing given back from it, never on a tab.
    expect((await request(context.app).put(`/api/documents/${id}/fiscal-receipt`).set(auth).send({ fiscalReceiptNo: '123' })).status).toBe(409);
    expect((await request(context.app).get('/api/counter/receipts?number=FSM-25-000002').set(auth)).body.data).toEqual([]);
    const customer = await context.db.selectFrom('customers').select('id').where('name', '=', 'G Pastrimi SH.P.K.').executeTakeFirstOrThrow();
    expect((await request(context.app).get(`/api/customers/${customer.id}`).set(auth)).body.data.balance).toBe(0);

    const card = await context.db.selectFrom('sales').select('notes').where('receipt_no', '=', 'K-26-00000010').executeTakeFirstOrThrow();
    expect(card.notes).toBe('Paid by card or bank in TREFIN');

    const events = (await request(context.app).get('/api/counter/events?from=2023-06-01&to=2023-06-30').set(auth)).body.data as Array<Record<string, unknown>>;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'trefin_deleted', amount: 2.6, trefin: { deletedBy: 'Administratori', number: 'K-23-00000819', soldOn: '2023-06-06', customer: null, lines: [{ name: 'Golden Eagle (old)', quantity: 2, total: 2.6 }] } });
    expect(events[0]!.at).toBe('2023-06-06T15:20:00.000Z');
    expect((await request(context.app).get('/api/counter/events?from=2023-06-01&to=2023-06-30&source=4vd').set(auth)).body.data).toEqual([]);
  });

  it("should keep TREFIN's starting stock, corrections and counts as history on each product, moving no stock", async () => {
    const data = sample();
    const move = (type: string, code: string, extra: Record<string, string>) => ({ LlojDok: type, NrArt: code, Sasia_Pranuar: '0', Sasia: '0', Kostoja: '0', ...extra });
    const counted = (db: string) => [{ NrRen: db === 'MARKET_2025' ? '7' : '46253', NrFatura: 'INV-24-000001', Data: '2024-04-25 00:00:00', NrArt: '339', Sasia: '0', SasiaM: '-5', CmimiB: '0.3' }];
    data.history = {
      ...emptyHistory(),
      stockMoves: {
        ...EACH,
        // TREFIN dates every starting stock 1 Jan 2022; the database's first other movement says when it really began.
        MARKET_2025: [
          move('GJF', '339', { Data: '2022-01-01 00:00:00', Sasia_Pranuar: '9', Kostoja: '0.3' }),
          move('GJF', '679', { Data: '2022-01-01 00:00:00' }),
          move('KUP', '339', { Data: '2025-03-15 00:00:00', Sasia: '1' }),
        ],
        MARKET_2022: [move('REGJ', '339', { Data: '2024-04-24 00:00:00', NrRen: '46258', NrFatura: 'REGJ-1', Sasia: '5', Kostoja: '0.3' })],
      },
      // The same count kept in two databases is taken once.
      stockCounts: { ...EACH, MARKET_2025: counted('MARKET_2025'), MARKET_2022: counted('MARKET_2022') },
    };

    const report = await importTrefin(context.db, data, { apply: true, timeZone: TZ });

    expect(report.created).toMatchObject({ stockDocuments: 3, stockLines: 3 });
    const token = await loginAs(context, 'admin');
    const auth = { Authorization: `Bearer ${token}` };
    const documents = (await request(context.app).get('/api/stock-counts/trefin').set(auth)).body.data as Array<Record<string, unknown>>;
    expect(documents.map((row) => [row.kind, row.number, row.dated, row.lineCount, row.value])).toEqual([
      ['opening', null, '2025-03-15', 1, 2.7],
      ['count', 'INV-24-000001', '2024-04-25', 1, -1.5],
      ['correction', 'REGJ-1', '2024-04-24', 1, 1.5],
    ]);
    expect(documents[0]!.source).toBe('MARKET_2025');
    const count = (await request(context.app).get(`/api/stock-counts/trefin/${documents[1]!.id}`).set(auth)).body.data as { lines: Array<Record<string, unknown>> };
    expect(count.lines).toEqual([{ productId: expect.any(Number), productName: 'Golden Eagle 0.25L', sku: '339', quantity: -5, counted: 0, unitCost: 0.3 }]);

    const productId = count.lines[0]!.productId as number;
    const stock = (await request(context.app).get(`/api/inventory/${productId}`).set(auth)).body.data as { quantity: number; trefinHistory: Array<Record<string, unknown>> };
    expect(stock.trefinHistory.map((row) => [row.kind, row.quantity, row.counted])).toEqual([
      ['opening', 9, null],
      ['count', -5, 0],
      ['correction', 5, null],
    ]);
    // History only: the stock is still what TREFIN said it was on the day of the export.
    expect(stock.quantity).toBe(12);
    expect((await request(context.app).get('/api/stock-counts/trefin/999999').set(auth)).status).toBe(404);
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
