import request from 'supertest';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestCategory, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let categoryId: number;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
  categoryId = (await createTestCategory(context.db)).id;
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createAndSell(name: string, quantity: number) {
  const created = await request(context.app)
    .post('/api/products')
    .set(auth(adminToken))
    .send({ name, categoryId, price: 100, costPrice: 60, stock: 50, sku: `SKU-${quantity}` });
  await request(context.app)
    .post('/api/sales')
    .set(auth(adminToken))
    .send({ productId: created.body.data.id, quantity, saleDate: '2026-03-10T12:00:00Z' });
}

const download = (path: string) => request(context.app).get(path).set(auth(adminToken)).buffer(true);

describe('CSV exports', () => {
  it('should export sales with a BOM, headers and a dated filename', async () => {
    await createAndSell('Oak Chair', 2);

    const response = await download('/api/exports/sales.csv?startDate=2026-03-01&endDate=2026-03-31');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toBe('attachment; filename="4vd-sales-2026-03-01-to-2026-03-31.csv"');
    expect(response.text.startsWith('﻿Date,Product,SKU,Quantity,Unit price,Total,Unit cost,Profit,Sold by,Notes,Type\r\n')).toBe(true);
    expect(response.text).toContain(',Oak Chair,SKU-2,2,100,200,60,80,Test admin,');
  });

  it('should name the file and write dates in the admin timezone', async () => {
    const created = await request(context.app)
      .post('/api/products')
      .set(auth(adminToken))
      .send({ name: 'Night Lamp', categoryId, price: 50, stock: 5 });
    // 00:30 on September 1st in Dublin (UTC+1 in summer).
    await request(context.app)
      .post('/api/sales')
      .set(auth(adminToken))
      .send({ productId: created.body.data.id, quantity: 1, saleDate: '2026-08-31T23:30:00Z' });

    const response = await download(
      '/api/exports/sales.csv?startDate=2026-08-31T23:00:00Z&endDate=2026-09-30T23:00:00Z&tz=Europe/Dublin',
    );

    expect(response.headers['content-disposition']).toBe('attachment; filename="4vd-sales-2026-09-01-to-2026-09-30.csv"');
    expect(response.text).toContain('\r\n2026-09-01 00:30,Night Lamp,');
  });

  it('should write Excel-friendly UTC dates when no timezone is given, and reject unknown ones', async () => {
    await createAndSell('Oak Chair', 2);

    const utc = await download('/api/exports/sales.csv?startDate=2026-03-01&endDate=2026-03-31');
    const unknown = await download('/api/exports/sales.csv?startDate=2026-03-01&endDate=2026-03-31&tz=Mars/Olympus');

    expect(utc.text).toContain('\r\n2026-03-10 12:00,Oak Chair,');
    expect(unknown.status).toBe(400);
  });

  it('should keep a product name with commas, quotes and line breaks in one cell', async () => {
    await createAndSell('Chair, "oak"\nlarge', 1);

    const response = await download('/api/exports/sales.csv?startDate=2026-03-01&endDate=2026-03-31');

    expect(response.text).toContain(',"Chair, ""oak""\nlarge",SKU-1,1,');
  });

  it('should defuse names that start like a formula', async () => {
    await createAndSell('=HYPERLINK("http://evil")', 1);

    const response = await download('/api/exports/sales.csv?startDate=2026-03-01&endDate=2026-03-31');

    expect(response.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it('should export stock with value and days left', async () => {
    await createAndSell('Oak Chair', 2);

    const response = await download('/api/exports/stock.csv');

    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="4vd-stock-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(response.text).toContain('Product,SKU,Category,In stock,Reorder level,Price,Cost,Stock value,Days left');
    expect(response.text).toContain('Oak Chair,SKU-2,Furniture,48,10,100,60,2880,');
  });

  it('should export the team report', async () => {
    await createAndSell('Oak Chair', 2);

    const response = await download('/api/exports/team.csv?startDate=2026-03-01&endDate=2026-03-31');

    expect(response.text).toContain('Name,Role,Sales,Units sold,Revenue,Refunds,Profit,Average sale');
    expect(response.text).toContain('Test admin,admin,1,2,200,0,80,200');
  });

  it('should be admin only and return JSON errors', async () => {
    const employeeToken = await loginAs(context, 'employee');

    const forbidden = await request(context.app).get('/api/exports/stock.csv').set(auth(employeeToken));
    const invalid = await download('/api/exports/sales.csv');

    expect(forbidden.status).toBe(403);
    expect(invalid.status).toBe(400);
    expect(invalid.body.success).toBe(false);
  });
});

describe('Excel exports', () => {
  const workbook = async (path: string) => {
    const response = await request(context.app)
      .get(path)
      .set(auth(adminToken))
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(new Uint8Array(response.body as Buffer).buffer as ArrayBuffer);
    return { response, sheet: book.worksheets[0]! };
  };

  it('should write a titled sheet with typed cells, filters and a totals row', async () => {
    await createAndSell('Oak Chair', 2);
    await createAndSell('=HYPERLINK("http://evil")', 1);

    const { response, sheet } = await workbook('/api/exports/sales.xlsx?startDate=2026-03-01&endDate=2026-03-31');

    expect(response.headers['content-type']).toContain('spreadsheetml');
    expect(response.headers['content-disposition']).toBe('attachment; filename="4vd-sales-2026-03-01-to-2026-03-31.xlsx"');
    expect(sheet.name).toBe('Sales');
    expect(sheet.getCell('A1').value).toBe('4VD  ·  Sales');
    expect(String(sheet.getCell('A2').value)).toContain('1 Mar 2026 to 31 Mar 2026');
    expect(sheet.getRow(4).getCell(1).value).toBe('Date');
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 });
    expect(sheet.autoFilter).toBeTruthy();

    const rows = [5, 6].map((index) => sheet.getRow(index));
    expect(rows.some((row) => row.getCell(2).value === 'Oak Chair')).toBe(true);
    // A real date and real money, not text.
    expect(rows[0]!.getCell(1).value).toBeInstanceOf(Date);
    expect(rows.find((row) => row.getCell(2).value === 'Oak Chair')!.getCell(6).value).toBe(200);
    expect(rows[0]!.getCell(6).numFmt).toContain('€');
    // Formula-looking names stay text.
    expect(rows.some((row) => row.getCell(2).value === `'=HYPERLINK("http://evil")`)).toBe(true);

    const totals = sheet.getRow(7);
    expect(totals.getCell(1).value).toBe('Total');
    expect(totals.getCell(6).value).toMatchObject({ formula: 'SUM(F5:F6)', result: 300 });
  });

  it('should keep the CSV money sheet with its total row', async () => {
    await createAndSell('Oak Chair', 2);

    const response = await download('/api/exports/money.csv?startDate=2026-03-10&endDate=2026-03-10');

    expect(response.text).toContain('2026-03-10,200,0,0,0,200\r\nTotal,200,0,0,0,200\r\n');
  });
});
