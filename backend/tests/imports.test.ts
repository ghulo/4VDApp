import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAsBusiness } from '../src/database/businessContext.js';
import { createTestProduct, loginAs, resetData, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers/testApp.js';

/**
 * Settings → Import: a sheet comes in as new products (or changes to ones the
 * shop has), and Undo takes it back exactly: new rows go, changed ones get
 * their old values, and whatever has been used since stays.
 */

let context: TestContext;
let token: string;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  token = await loginAs(context, 'main_admin');
});
afterAll(() => context.db.destroy());

const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

async function xlsx(sheets: Record<string, Array<Array<string | number | null>>>): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = workbook.addWorksheet(name);
    for (const row of rows) sheet.addRow(row);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
}

const PRODUCTS = [
  ['Barkodi', 'Emri', 'Kategoria', 'Çmimi', 'Kosto', 'TVSH', 'Stoku'],
  ['3830000000017', 'Ujë Rugove 0.5L', 'Ujë', 0.5, 0.3, 18, 24],
  ['3830000000024', 'Coca Cola 0.33L', 'Pije freskuese', 0.8, 0.55, 18, 12],
  ['3830000000031', 'Bukë e bardhë', 'Bukë', 0.4, 0.25, 8, 0],
];

async function upload(sheets: Record<string, Array<Array<string | number | null>>>, t = token) {
  const response = await request(context.app)
    .post('/api/imports')
    .set(auth(t))
    .send({ files: [{ name: 'lista.xlsx', data: await xlsx(sheets) }] });
  expect(response.status).toBe(201);
  return response.body.data as { id: number; status: string; preview: { counts: Record<string, Record<string, number>>; problems: Array<{ key: string }>; changes: unknown[] } };
}

async function runToEnd(id: number, t = token) {
  const started = await request(context.app).post(`/api/imports/${id}/run`).set(auth(t));
  expect(started.status).toBe(202);
  await vi.waitFor(
    async () => {
      const view = await request(context.app).get(`/api/imports/${id}`).set(auth(t));
      expect(view.body.data.status).toBe('done');
    },
    { timeout: 10_000, interval: 50 },
  );
}

const products = () => context.db.selectFrom('products').select(['id', 'name', 'barcode', 'base_price', 'cost_price', 'vat_rate']).orderBy('id').execute();

describe('importing a sheet of products', () => {
  it('reads it, shows a preview, brings it in with stock and categories, and undoes it all', async () => {
    const batch = await upload({ Produktet: PRODUCTS });
    expect(batch.status).toBe('ready');
    expect(batch.preview.counts.products).toMatchObject({ new: 3, changed: 0, skipped: 0 });

    await runToEnd(batch.id);
    const rows = await products();
    expect(rows.map((p) => p.name)).toEqual(['Ujë Rugove 0.5L', 'Coca Cola 0.33L', 'Bukë e bardhë']);
    expect(rows[2]).toMatchObject({ barcode: '3830000000031', base_price: '0.40', cost_price: '0.25', vat_rate: 8 });
    const stock = await context.db.selectFrom('inventory').select(['product_id', 'quantity_on_hand']).orderBy('product_id').execute();
    expect(stock.map((s) => s.quantity_on_hand)).toEqual([24, 12, 0]);
    const located = await context.db.selectFrom('location_stock').select('quantity').orderBy('product_id').execute();
    expect(located.map((s) => Number(s.quantity))).toEqual([24, 12, 0]);
    const categories = await context.db.selectFrom('categories').select('name').orderBy('name').execute();
    expect(categories.map((c) => c.name)).toEqual(['Bukë', 'Pije freskuese', 'Ujë']);
    const logged = await context.db.selectFrom('activity_log').select(['action', 'summary']).where('action', '=', 'import.done').execute();
    expect(logged).toHaveLength(1);
    expect(logged[0]!.summary).toContain('3 new products');

    const plan = await request(context.app).get(`/api/imports/${batch.id}/undo`).set(auth());
    expect(plan.status).toBe(200);
    expect(plan.body.data.blockers).toEqual([]);
    expect(plan.body.data.kinds[0]).toMatchObject({ kind: 'products', created: 3, kept: 0 });

    const undone = await request(context.app).post(`/api/imports/${batch.id}/undo`).set(auth()).send({ kinds: ['products'] });
    expect(undone.status).toBe(200);
    expect(undone.body.data.status).toBe('undone');
    expect(await products()).toEqual([]);
    expect(await context.db.selectFrom('categories').select('id').execute()).toEqual([]);
  });

  it('changes only what differs on products the shop has, and Undo puts the old values back', async () => {
    const id = await createTestProduct(context, token, { name: 'Ujë Rugove 0.5L', price: 0.45, costPrice: 0.3, stock: 7 });
    await context.db.updateTable('products').set({ barcode: '3830000000017' }).where('id', '=', id).execute();
    const batch = await upload({ Produktet: PRODUCTS.slice(0, 3) });
    expect(batch.preview.counts.products).toMatchObject({ new: 1, changed: 1 });

    await runToEnd(batch.id);
    const changed = await context.db.selectFrom('products').select(['base_price']).where('id', '=', id).executeTakeFirstOrThrow();
    expect(changed.base_price).toBe('0.50');
    expect(await stockOfProduct(id)).toBe(7); // stock is never changed on a product the shop has
    const history = await context.db.selectFrom('activity_log').select(['details']).where('action', '=', 'product.updated').where('entity_id', '=', id).execute();
    expect(history.at(-1)!.details).toMatchObject({ source: 'import', price: { from: 0.45, to: 0.5 } });

    await request(context.app).post(`/api/imports/${batch.id}/undo`).set(auth()).send({ kinds: ['products'] }).expect(200);
    const back = await context.db.selectFrom('products').select(['base_price', 'deleted_at']).where('id', '=', id).executeTakeFirstOrThrow();
    expect(back).toMatchObject({ base_price: '0.45', deleted_at: null });
    expect((await products()).map((p) => p.name)).toEqual(['Ujë Rugove 0.5L']);
  });

  it('keeps a price someone changed again after the import, and says so', async () => {
    const id = await createTestProduct(context, token, { name: 'Ujë Rugove 0.5L', price: 0.45, costPrice: 0.3 });
    await context.db.updateTable('products').set({ barcode: '3830000000017' }).where('id', '=', id).execute();
    const batch = await upload({ Produktet: PRODUCTS.slice(0, 2) });
    await runToEnd(batch.id);
    await context.db.updateTable('products').set({ base_price: 0.55 }).where('id', '=', id).execute();

    const plan = await request(context.app).get(`/api/imports/${batch.id}/undo`).set(auth());
    expect(plan.body.data.kinds[0].changedSince).toEqual([{ name: 'Ujë Rugove 0.5L', fields: ['price'] }]);
    const undone = await request(context.app).post(`/api/imports/${batch.id}/undo`).set(auth()).send({ kinds: ['products'] });
    expect(undone.body.data.status).toBe('partly_undone');
    expect((await context.db.selectFrom('products').select('base_price').where('id', '=', id).executeTakeFirstOrThrow()).base_price).toBe('0.55');
  });

  it('keeps a product that has been sold, names it, and takes back the rest', async () => {
    const batch = await upload({ Produktet: PRODUCTS });
    await runToEnd(batch.id);
    const [water] = await products();
    await request(context.app).post('/api/sales').set(auth()).send({ productId: water!.id, quantity: 1 }).expect(201);

    const plan = await request(context.app).get(`/api/imports/${batch.id}/undo`).set(auth());
    expect(plan.body.data.blockers).toEqual([{ kind: 'products', usedBy: 'sales', count: 1, names: ['Ujë Rugove 0.5L'] }]);
    expect(plan.body.data.kinds[0]).toMatchObject({ created: 3, kept: 1 });

    const undone = await request(context.app).post(`/api/imports/${batch.id}/undo`).set(auth()).send({ kinds: ['products'] });
    expect(undone.body.data.status).toBe('partly_undone');
    expect((await products()).map((p) => p.name)).toEqual(['Ujë Rugove 0.5L']);
    // Its category stays with it; the empty ones go.
    expect((await context.db.selectFrom('categories').select('name').execute()).map((c) => c.name)).toEqual(['Ujë']);
  });

  it('still undoes when a product it made is already gone', async () => {
    const batch = await upload({ Produktet: PRODUCTS });
    await runToEnd(batch.id);
    const [water] = await products();
    await context.db.deleteFrom('products').where('id', '=', water!.id).execute();

    const undone = await request(context.app).post(`/api/imports/${batch.id}/undo`).set(auth()).send({ kinds: ['products'] });
    expect(undone.status).toBe(200);
    expect(undone.body.data.status).toBe('undone');
    expect(await products()).toEqual([]);
  });

  it('brings in suppliers with what is owed as an opening bill, and takes it back', async () => {
    await sql`insert into settings (key, value) values ('books_start', to_jsonb('2026-11-01'::text))`.execute(context.db);
    const batch = await upload({
      Furnitorët: [
        ['Kodi', 'Emri', 'NUI', 'Telefoni', 'Borxhi'],
        ['F001', 'Rugove SH.P.K.', '810000001', '044 000 000', 120.5],
        ['F002', 'Pa borxh', null, null, 0],
      ],
    });
    expect(batch.preview.counts.suppliers).toMatchObject({ new: 2 });
    await runToEnd(batch.id);
    const bills = await context.db.selectFrom('supplier_bills').select(['amount', 'brought_over', 'issued_on']).execute();
    expect(bills).toMatchObject([{ amount: '120.50', brought_over: true }]);
    expect(await context.db.selectFrom('opening_lines').select('kind').where('kind', '=', 'supplier').execute()).toHaveLength(1);

    await request(context.app).post(`/api/imports/${batch.id}/undo`).set(auth()).send({ kinds: ['suppliers'] }).expect(200);
    expect(await context.db.selectFrom('suppliers').select('id').execute()).toEqual([]);
    expect(await context.db.selectFrom('supplier_bills').select('id').execute()).toEqual([]);
  });

  it('keeps what is owed in the note when the books have no start day', async () => {
    const batch = await upload({ Furnitorët: [['Kodi', 'Emri', 'Borxhi'], ['F001', 'Rugove SH.P.K.', 80]] });
    expect(batch.preview).toMatchObject({ warnings: [{ key: 'owedKeptInNote' }] });
    await runToEnd(batch.id);
    const supplier = await context.db.selectFrom('suppliers').select(['note']).executeTakeFirstOrThrow();
    expect(supplier.note).toContain('€80.00');
    expect(await context.db.selectFrom('supplier_bills').select('id').execute()).toEqual([]);
  });

  it('reads a credit limit, discount or NUI of 0 as none, as old programs write it', async () => {
    const batch = await upload({
      Klientët: [
        ['Kodi', 'Emri', 'Limiti', 'Rabati', 'NUI'],
        ['K001', 'Pa limit', 0, 0, 0],
        ['K002', 'Me limit', 500, 5, '810 000 002'],
      ],
    });
    await runToEnd(batch.id);
    const customers = await context.db.selectFrom('customers').select(['name', 'credit_limit', 'discount_percent', 'nui']).orderBy('name').execute();
    expect(customers).toMatchObject([
      { name: 'Me limit', credit_limit: '500.00', discount_percent: '5.00', nui: '810000002' },
      { name: 'Pa limit', credit_limit: null, discount_percent: null, nui: null },
    ]);
  });

  it('says plainly when a file has a password', async () => {
    // A password-protected .xlsx is an old-style Office file holding an "EncryptedPackage" stream.
    const locked = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64), Buffer.from('EncryptedPackage', 'utf16le')]);
    const response = await request(context.app)
      .post('/api/imports')
      .set(auth())
      .send({ files: [{ name: 'lista.xlsx', data: locked.toString('base64') }] });
    expect(response.status).toBe(201);
    expect(response.body.data.health).toEqual([{ file: 'lista.xlsx', key: 'password' }]);
  });

  it('is only for those with the import power, and stays inside its business', async () => {
    const admin = await loginAs(context, 'admin');
    await request(context.app).get('/api/imports').set(auth(admin)).expect(403);

    const batch = await upload({ Produktet: PRODUCTS });
    const otherId = (await context.db.insertInto('businesses').values({ name: 'Other shop' }).returning('id').executeTakeFirstOrThrow()).id;
    const passwordHash = (await context.db.selectFrom('users').select('password_hash').executeTakeFirstOrThrow()).password_hash;
    await runAsBusiness(otherId, () =>
      context.db
        .insertInto('users')
        .values({ email: 'main@other.local', name: 'Other', role: 'main_admin', is_active: true, password_hash: passwordHash, business_id: otherId, email_verified_at: new Date() })
        .execute(),
    );
    const login = await request(context.app).post('/api/auth/login').send({ email: 'main@other.local', password: TEST_PASSWORD });
    const other = login.body.data.token as string;
    await request(context.app).get(`/api/imports/${batch.id}`).set(auth(other)).expect(404);
    expect((await request(context.app).get('/api/imports').set(auth(other))).body.data).toEqual([]);

    // The import runs in the background, yet writes in the business that started it.
    await runAsBusiness(otherId, () => sql`INSERT INTO stock_locations (name, sells_here, receives_here) VALUES ('Shop floor', true, true)`.execute(context.db));
    const theirs = await upload({ Produktet: PRODUCTS }, other);
    await runToEnd(theirs.id, other);
    expect(await products()).toEqual([]);
    const inOther = await runAsBusiness(otherId, () => context.db.selectFrom('products').select('name').execute());
    expect(inOther).toHaveLength(3);
  });

  it('keeps products whose stock is in posted opening balances', async () => {
    const batch = await upload({ Produktet: PRODUCTS });
    await runToEnd(batch.id);
    await sql`insert into settings (key, value) values ('opening_posted', '{"id": 1}'::jsonb)`.execute(context.db);

    const plan = await request(context.app).get(`/api/imports/${batch.id}/undo`).set(auth());
    expect(plan.body.data.blockers).toEqual([{ kind: 'products', usedBy: 'openingPosted', count: 2, names: ['Coca Cola 0.33L', 'Ujë Rugove 0.5L'] }]);
    await request(context.app).post(`/api/imports/${batch.id}/undo`).set(auth()).send({ kinds: ['products'] }).expect(200);
    expect((await products()).map((p) => p.name)).toEqual(['Ujë Rugove 0.5L', 'Coca Cola 0.33L']);
  });

  it('leaves sales history inside a zip unread, and says it was left out', async () => {
    const zip = new JSZip();
    zip.file('export/products.csv', 'Barkodi;Emri;Çmimi\n3830000000017;Ujë Rugove 0.5L;0,50\n');
    zip.file('export/sales.csv', 'date,product,qty\n2026-01-01,x,1\n');
    const data = (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64');
    const response = await request(context.app).post('/api/imports').set(auth()).send({ files: [{ name: 'export.zip', data }] });
    expect(response.status).toBe(201);
    expect(response.body.data.preview.counts.products).toMatchObject({ new: 1 });
    expect(response.body.data.health).toContainEqual({ file: 'export/sales.csv', key: 'leftOut', why: 'history' });
  });

  it('sends only a known export’s own files from its folder, and sets each subfolder aside as one line', async () => {
    const names = [
      'TREFIN-export/products.csv',
      'TREFIN-export/suppliers.csv',
      'TREFIN-export/sales.csv',
      'TREFIN-export/REPORT.md',
      'TREFIN-export/extra.csv',
      'TREFIN-export/raw/MARKET_2025/tblArka.csv',
      'TREFIN-export/raw/MARKET_2025/products.csv',
      'TREFIN-export/db_backups/MARKET.bak',
    ];
    const response = await request(context.app).post('/api/imports/wanted').set(auth()).send({ names });
    expect(response.status).toBe(200);
    expect(response.body.data.send).toEqual(['TREFIN-export/products.csv', 'TREFIN-export/suppliers.csv']);
    expect(response.body.data.leaveOut).toEqual([
      { file: 'TREFIN-export/sales.csv', why: 'history' },
      { file: 'TREFIN-export/REPORT.md', why: 'notSpreadsheet' },
      { file: 'TREFIN-export/extra.csv', why: 'notNeeded' },
      { file: 'TREFIN-export/raw', why: 'otherData' },
      { file: 'TREFIN-export/db_backups', why: 'otherData' },
    ]);
  });
});

describe('sorting products with no category', () => {
  let sorted: TestContext;
  let sortedToken: string;
  const asked: string[] = [];
  const fakeAi = {
    name: 'fake',
    generate: async () => '',
    generateJson: async <T,>({ request: text }: { instructions: string; request: string }) => {
      asked.push(text);
      const keys = text.split('\n').filter((line) => line.includes(' | ')).map((line) => line.split(' | ')[0]!);
      return { products: keys.map((key) => ({ key, category: key.endsWith('17') ? 'Ujë' : 'Bukë dhe furrë' })) } as T;
    },
  };

  beforeAll(async () => {
    sorted = await setupTestApp({ aiProvider: fakeAi });
    await resetData(sorted.db);
    sortedToken = await loginAs(sorted, 'main_admin');
  });
  afterAll(() => sorted.db.destroy());

  it('asks the AI while reading, then brings them into the categories it picked', async () => {
    // The file's beforeEach empties the sessions too: sign in again after it (it made main_admin already).
    sortedToken = await loginAs(sorted, 'main_admin', { email: 'sorter@test.local' });
    const response = await request(sorted.app)
      .post('/api/imports')
      .set(auth(sortedToken))
      .send({ files: [{ name: 'lista.xlsx', data: await xlsx({ Produktet: [['Barkodi', 'Emri', 'Çmimi', 'Kodi'], ['3830000000017', 'Ujë Rugove', 0.5, 'A17'], ['3830000000024', 'Bukë', 0.4, 'A24']] }) }] });
    expect(response.status).toBe(201);
    const id = response.body.data.id as number;
    await vi.waitFor(
      async () => expect((await request(sorted.app).get(`/api/imports/${id}`).set(auth(sortedToken))).body.data.status).toBe('ready'),
      { timeout: 10_000, interval: 50 },
    );
    expect(asked).toHaveLength(1);
    const view = await request(sorted.app).get(`/api/imports/${id}`).set(auth(sortedToken));
    expect(view.body.data.preview.problems.map((p: { key: string }) => p.key)).not.toContain('noCategory');

    await request(sorted.app).post(`/api/imports/${id}/run`).set(auth(sortedToken)).expect(202);
    await vi.waitFor(
      async () => expect((await request(sorted.app).get(`/api/imports/${id}`).set(auth(sortedToken))).body.data.status).toBe('done'),
      { timeout: 10_000, interval: 50 },
    );
    const rows = await sql<{ name: string; category: string }>`select p.name, c.name as category from products p join categories c on c.id = p.category_id order by p.id`.execute(sorted.db);
    expect(rows.rows).toEqual([
      { name: 'Ujë Rugove', category: 'Ujë' },
      { name: 'Bukë', category: 'Bukë dhe furrë' },
    ]);
  });
});

async function stockOfProduct(id: number): Promise<number> {
  const row = await context.db.selectFrom('inventory').select('quantity_on_hand').where('product_id', '=', id).executeTakeFirstOrThrow();
  return row.quantity_on_hand;
}
