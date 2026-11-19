import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { readFiles } from '../src/services/import/files.js';
import { readCsv, readXlsx } from '../src/services/money/statementFile.js';
import { TooBigToUnpackError, UNPACK_LIMITS, UnpackBudget, type UnpackLimits } from '../src/utils/unpackLimits.js';
import { loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

/**
 * A small upload can unpack into gigabytes (a zip bomb), a zip can hold a
 * million files, a sheet a million rows. Every reader of uploaded files
 * stops at the limits in utils/unpackLimits.ts with a plain 400 or note,
 * and normal files still read as before.
 */

const SMALL: UnpackLimits = { bytes: 50_000, entries: 20, rows: 100, cells: 1_000 };
const small = () => new UnpackBudget(SMALL);

async function zipOf(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(name, text);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** A real workbook from ExcelJS whose first sheet's XML is then swapped for the given rows. */
async function workbookWith(sheetData: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Sheet1').addRow(['a']);
  const zip = await JSZip.loadAsync(Buffer.from(await workbook.xlsx.writeBuffer()));
  const name = Object.keys(zip.files).find((file) => /^xl\/worksheets\/sheet1\.xml$/.test(file))!;
  const xml = await zip.file(name)!.async('string');
  zip.file(name, xml.replace(/<sheetData>[\s\S]*<\/sheetData>|<sheetData\/>/, `<sheetData>${sheetData}</sheetData>`));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function plainWorkbook(rows: Array<Array<string | number>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Rewrites every size a zip states for its files (local and central headers) to a lie. */
function lieAboutSizes(bytes: Buffer, size: number): Buffer {
  const out = Buffer.from(bytes);
  for (let i = 0; i + 4 <= out.length; i += 1) {
    const signature = out.readUInt32LE(i);
    if (signature === 0x04034b50) out.writeUInt32LE(size, i + 22);
    if (signature === 0x02014b50) out.writeUInt32LE(size, i + 24);
  }
  return out;
}

async function limitOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(TooBigToUnpackError);
  return (error as TooBigToUnpackError).limit;
}

describe('the unpack limits', () => {
  it('has the agreed caps', () => {
    expect(UNPACK_LIMITS).toEqual({ bytes: 200 * 1024 * 1024, entries: 5_000, rows: 200_000, cells: 5_000_000 });
  });

  it('stops a zip whose file unpacks past the byte limit', async () => {
    const zip = await small().openZip(await zipOf({ 'a.csv': 'a'.repeat(200_000) }));
    expect(await limitOf(small().read(zip.file('a.csv')!, true))).toBe('bytes');
  });

  it('stops on the real bytes when the zip lies about its sizes', async () => {
    const lying = lieAboutSizes(await zipOf({ 'a.csv': 'a'.repeat(200_000) }), 10);
    const budget = small();
    const zip = await budget.openZip(lying);
    // The declared size passes; only counting the bytes as they come catches it (not JSZip's own size check at the end).
    expect(await limitOf(budget.read(zip.file('a.csv')!, true))).toBe('bytes');
  });

  it('refuses a zip with too many files, even when its end record says fewer', async () => {
    const files = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${i}.csv`, 'x']));
    const many = await zipOf(files);
    expect(await limitOf(small().openZip(many))).toBe('entries');
    const lying = Buffer.from(many);
    const end = lying.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    lying.writeUInt16LE(1, end + 8);
    lying.writeUInt16LE(1, end + 10);
    expect(await limitOf(small().openZip(lying))).toBe('entries');
  });

  it('counts a workbook’s rows before ExcelJS opens it, tags split between chunks included', async () => {
    const rows = '<row r="1"/>'.repeat(101);
    expect(await limitOf(readXlsx(await workbookWith(rows), small()))).toBe('rows');
    // About 1,000 rows is more than one 16 KB chunk of XML; the count must be exact across chunks.
    const budget = new UnpackBudget({ ...SMALL, rows: 1_000 });
    await expect(budget.checkWorkbook(await workbookWith('<row r="1"/>'.repeat(1_000)))).resolves.toBeUndefined();
    expect(await limitOf(new UnpackBudget({ ...SMALL, rows: 999 }).checkWorkbook(await workbookWith('<row r="1"/>'.repeat(1_000))))).toBe('rows');
  });

  it('stops a workbook whose XML unpacks past the byte limit', async () => {
    const huge = `<row r="1"><c r="A1" t="inlineStr"><is><t>${'x'.repeat(200_000)}</t></is></c></row>`;
    expect(await limitOf(readXlsx(await workbookWith(huge), small()))).toBe('bytes');
  });

  it('stops a few rows that each reach far to the right', async () => {
    const wide = Array.from({ length: 5 }, (_, i) => `<row r="${i + 1}"><c r="XFD${i + 1}" t="inlineStr"><is><t>x</t></is></c></row>`).join('');
    expect(await limitOf(readXlsx(await workbookWith(wide), small()))).toBe('cells');
  });

  it('stops one row holding a flood of cells before ExcelJS builds them', async () => {
    const flood = `<row r="1">${'<c r="A1"/>'.repeat(1_001)}</row>`;
    const budget = small();
    expect(await limitOf(budget.checkWorkbook(await workbookWith(flood)))).toBe('cells');
  });

  it('stops a CSV with too many rows', () => {
    expect(() => readCsv(Buffer.from('a;b\n'.repeat(101)), small())).toThrow(TooBigToUnpackError);
  });

  it('still reads normal files', async () => {
    expect(await readXlsx(await plainWorkbook([['Data', 'Shuma'], ['13.10.2026', 12.5]]), small())).toEqual([
      ['Data', 'Shuma'],
      ['13.10.2026', 12.5],
    ]);
    expect(readCsv(Buffer.from('Data;Shuma\n13.10.2026;12,50\n'), small())).toEqual([
      ['Data', 'Shuma'],
      ['13.10.2026', '12,50'],
    ]);
    const read = await readFiles([{ name: 'export.zip', bytes: await zipOf({ 'export/products.csv': 'Barkodi;Emri\n3830000000017;Ujë\n' }) }], small());
    expect(read.notes).toEqual([]);
    expect(read.sheets[0]!.rows).toEqual([
      ['Barkodi', 'Emri'],
      ['3830000000017', 'Ujë'],
    ]);
  });

  it('leaves a too-big file out of an import with a note, and the files before it in', async () => {
    const read = await readFiles(
      [
        { name: 'products.csv', bytes: Buffer.from('Barkodi;Emri\n3830000000017;Ujë\n') },
        { name: 'bomb.zip', bytes: lieAboutSizes(await zipOf({ 'a.csv': 'a'.repeat(200_000) }), 10) },
      ],
      small(),
    );
    expect(read.sheets.map((sheet) => sheet.file)).toEqual(['products.csv']);
    expect(read.notes).toEqual([{ file: 'bomb.zip/a.csv', key: 'zipTooBig' }]);
  });

  it('gives a refused file’s rows back, so a small file after it still reads', async () => {
    const read = await readFiles(
      [
        { name: 'sales.csv', bytes: Buffer.from('a;b\n'.repeat(150)) },
        { name: 'products.csv', bytes: Buffer.from('Barkodi;Emri\n3830000000017;Ujë\n') },
      ],
      small(),
    );
    expect(read.sheets.map((sheet) => sheet.file)).toEqual(['products.csv']);
    expect(read.notes).toEqual([{ file: 'sales.csv', key: 'zipTooBig' }]);
  });

  it('inside a zip, leaves out only the file that is too big', async () => {
    const zip = await zipOf({ 'export/big.csv': 'a;b\n'.repeat(150), 'export/products.csv': 'Barkodi;Emri\n3830000000017;Ujë\n' });
    const read = await readFiles([{ name: 'export.zip', bytes: zip }], small());
    expect(read.sheets.map((sheet) => sheet.file)).toEqual(['export/products.csv']);
    expect(read.notes).toEqual([{ file: 'export.zip/export/big.csv', key: 'zipTooBig' }]);
  });
});

describe('uploads that would unpack too far', () => {
  let context: TestContext;
  let token: string;
  /** Just over the real row limit: about 2.6 MB of XML, a few KB packed. */
  let rowBomb: string;

  beforeAll(async () => {
    context = await setupTestApp();
    rowBomb = (await workbookWith('<row r="1"/>'.repeat(UNPACK_LIMITS.rows + 1))).toString('base64');
  });
  beforeEach(async () => {
    await resetData(context.db);
    await seedBooks(context.db as never);
    token = await loginAs(context, 'main_admin');
  });
  afterAll(() => context.db.destroy());

  const api = () => request(context.app);
  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('Settings → Import keeps the batch but leaves the file out, saying it is too big', async () => {
    const response = await api()
      .post('/api/imports')
      .set(auth())
      .send({ files: [{ name: 'lista.xlsx', data: rowBomb }] });
    expect(response.status).toBe(201);
    const batch = await context.db.selectFrom('import_batches').select('draft').where('id', '=', response.body.data.id).executeTakeFirstOrThrow();
    expect((batch.draft as { notes: unknown[] }).notes).toEqual([{ file: 'lista.xlsx', key: 'zipTooBig' }]);
  });

  it('a bank statement is refused with a plain 400', async () => {
    const places = (await api().get('/api/money/places').set(auth())).body.data as Array<{ id: number; kind: string; isDefault: boolean }>;
    const bank = places.find((place) => place.kind === 'bank' && place.isDefault)!;
    const response = await api().post(`/api/money/places/${bank.id}/statements`).set(auth()).send({ fileName: 'ekstrakt.xlsx', data: rowBomb });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('more than 200,000 rows');
  });

  it('a price file is refused with a plain 400', async () => {
    const response = await api().post('/api/products/prices/file').set(auth()).send({ fileName: 'cmimet.xlsx', data: rowBomb });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('more than 200,000 rows');
  });
});
