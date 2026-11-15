import sharp from 'sharp';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BillPage, BillReader, BillReading } from '../src/services/ai/billReader.js';
import { loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

/** Hands back a fixed reading and counts what it was asked to read; can be told to fail. */
class FakeReader implements BillReader {
  sent: BillPage[][] = [];
  failWith: string | null = null;
  async read(pages: BillPage[]): Promise<BillReading> {
    this.sent.push(pages);
    if (this.failWith) throw new Error(this.failWith);
    return {
      supplier: { name: 'Fresh Foods LLC', nui: '811234567' },
      number: 'FF-77',
      issuedOn: '2026-11-10',
      dueOn: '2026-12-10',
      pricesIncludeVat: false,
      lines: [{ code: 'A1', barcode: null, name: 'Oak Chair', quantity: 2, unit: 'copë', unitsPerPack: null, unitPrice: 60, discountPercent: null, vatRate: 18, lineTotal: 120 }],
      totals: { net: 120, vat: 21.6, gross: 141.6 },
      remarks: null,
    };
  }
}

const TOKEN = 'bill-email-test-token-123456';
const reader = new FakeReader();
let context: TestContext;
let adminToken: string;

beforeAll(async () => {
  context = await setupTestApp({ billReader: reader }, { BILL_EMAIL_TOKEN: TOKEN, BILL_EMAIL_DAILY_READS: '2' });
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
  reader.sent = [];
  reader.failWith = null;
});
afterAll(() => context.db.destroy());

const api = () => request(context.app);
const auth = () => ({ Authorization: `Bearer ${adminToken}` });
const pdf = (text: string) => ({ name: `${text}.pdf`, mime: 'application/pdf', data: Buffer.from(`%PDF-1.4\n${text}\n`).toString('base64') });

let mailCount = 0;
async function send(body: Partial<{ messageId: string; from: string; subject: string | null; files: unknown[] }>, token = TOKEN) {
  mailCount += 1;
  const response = await api()
    .post('/api/internal/bill-email')
    .set(token ? { 'x-bill-email-token': token } : {})
    .send({ messageId: `<m${mailCount}@mail>`, from: 'admin@test.local', subject: 'Bill', files: [pdf('bill-a')], ...body });
  await context.container.billEmailService.settled();
  return response;
}

const scans = () => context.db.selectFrom('bill_scans').select(['id', 'email_from', 'status']).execute();
const rows = () => context.db.selectFrom('bill_emails').select(['id', 'status', 'scan_id', 'first_id']).orderBy('id').execute();
const notifications = () => context.db.selectFrom('notifications').select(['type', 'message']).where('type', '=', 'bill_email').execute();
const todo = async () => (await api().get('/api/attention').set(auth())).body.data.todo as Array<{ kind: string; title: string }>;

describe('emailed bills: who may send', () => {
  it('should refuse a missing or wrong token', async () => {
    expect((await send({}, '')).status).toBe(401);
    expect((await send({}, 'wrong-token-wrong-token-1234')).status).toBe(401);
    expect(await rows()).toEqual([]);
  });

  it('should drop mail from a stranger without keeping or reading anything', async () => {
    const response = await send({ from: 'someone@elsewhere.com' });

    expect(response.status).toBe(202);
    expect(response.body.data.status).toBe('ignored');
    expect(await rows()).toEqual([]);
    expect(reader.sent).toEqual([]);
  });

  it('should read a PDF from a team member into a waiting scan', async () => {
    const response = await send({ from: 'Admin@Test.local' });

    expect(response.body.data).toEqual({ status: 'accepted', waiting: 1, duplicates: 0 });
    expect(reader.sent).toHaveLength(1);
    expect(reader.sent[0]![0]!.mime).toBe('application/pdf');
    const scan = (await scans())[0]!;
    expect(scan).toMatchObject({ email_from: 'admin@test.local', status: 'waiting' });
    expect(await rows()).toEqual([expect.objectContaining({ status: 'read', scan_id: scan.id })]);

    const waiting = (await api().get('/api/bill-scans').set(auth())).body.data;
    expect(waiting).toEqual([expect.objectContaining({ id: scan.id, emailFrom: 'admin@test.local', scannedBy: null, supplierName: 'Fresh Foods LLC' })]);
    expect((await todo()).find((item) => item.kind === 'bill_scan')).toBeDefined();
  });

  it('should let in senders listed in Settings, by address or by @domain', async () => {
    const saved = await api().put('/api/bill-emails/settings').set(auth()).send({ senders: ['Office@Supplier.com', '@fresh.al', ''] });
    expect(saved.body.data.senders).toEqual(['office@supplier.com', '@fresh.al']);
    expect(saved.body.data.address).toBe('bills@4vd.app');

    expect((await send({ from: 'office@supplier.com', files: [pdf('one')] })).body.data.status).toBe('accepted');
    expect((await send({ from: 'anyone@fresh.al', files: [pdf('two')] })).body.data.status).toBe('accepted');
    expect((await send({ from: 'anyone@notfresh.al', files: [pdf('three')] })).body.data.status).toBe('ignored');
    expect(await scans()).toHaveLength(2);
  });

  it('should refuse an entry that is neither an address nor a domain', async () => {
    const response = await api().put('/api/bill-emails/settings').set(auth()).send({ senders: ['supplier.com'] });
    expect(response.status).toBe(400);
  });
});

describe('emailed bills: which files', () => {
  it('should take a big photo when there is no PDF, and leave logos alone', async () => {
    const photo = { name: 'IMG_1.jpg', mime: 'image/jpeg', data: Buffer.alloc(200 * 1024, 1).toString('base64') };
    const logo = { name: 'logo.png', mime: 'image/png', data: Buffer.alloc(5 * 1024, 2).toString('base64') };

    await send({ files: [logo] });
    expect(await rows()).toEqual([]);
    expect(await notifications()).toHaveLength(1);

    const withPdf = await send({ files: [photo, pdf('real-bill')] });
    expect(withPdf.body.data.waiting).toBe(1);
    expect(reader.sent[0]![0]!.mime).toBe('application/pdf');
  });

  it('should read a phone photo of a bill when there is no PDF', async () => {
    const jpeg = await sharp({ create: { width: 900, height: 900, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: 'gaussian', mean: 128, sigma: 60 } } })
      .jpeg({ quality: 100 })
      .toBuffer();
    expect(jpeg.length).toBeGreaterThan(150 * 1024);

    const response = await send({ files: [{ name: 'IMG_2.jpg', mime: 'image/jpeg', data: jpeg.toString('base64') }] });
    expect(response.body.data.waiting).toBe(1);
    expect(reader.sent).toHaveLength(1);
  });

  it('should take at most five files', async () => {
    const response = await send({ files: ['a', 'b', 'c', 'd', 'e', 'f'].map(pdf) });
    expect(response.body.data.waiting).toBe(5);
  });
});

describe('emailed bills: the same bill twice', () => {
  it('should take a mail delivered twice only once', async () => {
    const body = { messageId: '<same@mail>', files: [pdf('bill-a')] };
    await send(body);
    const again = await send(body);

    expect(again.body.data).toEqual({ status: 'accepted', waiting: 0, duplicates: 0 });
    expect(await rows()).toHaveLength(1);
    expect(reader.sent).toHaveLength(1);
  });

  it('should mark the same file in a later email as already received, without reading it', async () => {
    await send({ files: [pdf('bill-a')] });
    const later = await send({ files: [pdf('bill-a')] });

    expect(later.body.data).toEqual({ status: 'accepted', waiting: 0, duplicates: 1 });
    const [first, second] = (await rows()) as [Awaited<ReturnType<typeof rows>>[number], Awaited<ReturnType<typeof rows>>[number]];
    expect(second).toMatchObject({ status: 'duplicate', first_id: first.id });
    expect(reader.sent).toHaveLength(1);
    expect((await notifications())[0]!.message).toMatch(/already received on \d{4}-\d{2}-\d{2}/);
  });
});

describe('emailed bills: the daily cap and failures', () => {
  it('should leave files over the day\'s cap unread, in To do, until someone reads them', async () => {
    await send({ files: [pdf('one'), pdf('two'), pdf('three')] });

    expect(reader.sent).toHaveLength(2);
    const waiting = (await rows()).find((row) => row.status === 'waiting')!;
    // Shown once it has had time to be read.
    await context.db.updateTable('bill_emails').set({ received_at: sql<Date>`now() - interval '10 minutes'` } as never).where('id', '=', waiting.id).execute();
    expect((await todo()).filter((item) => item.kind === 'bill_email')).toHaveLength(1);
    expect((await api().get('/api/bill-emails').set(auth())).body.data).toEqual([expect.objectContaining({ id: waiting.id, status: 'waiting' })]);

    // The background pass keeps to the cap.
    context.container.billEmailService.kick();
    await context.container.billEmailService.settled();
    expect(reader.sent).toHaveLength(2);

    // Someone who runs the shop can read it anyway.
    const read = await api().post(`/api/bill-emails/${waiting.id}/read`).set(auth());
    expect(read.body.data.scanId).toEqual(expect.any(Number));
    expect(reader.sent).toHaveLength(3);
    expect((await todo()).filter((item) => item.kind === 'bill_email')).toEqual([]);
  });

  it('should show a file that could not be read, and let it be removed', async () => {
    reader.failWith = 'The AI service is busy';
    await send({});

    const row = (await rows())[0]!;
    expect(row.status).toBe('failed');
    expect((await todo()).filter((item) => item.kind === 'bill_email')).toHaveLength(1);

    await api().post(`/api/bill-emails/${row.id}/remove`).set(auth()).expect(200);
    expect((await rows())[0]!.status).toBe('removed');
    expect((await todo()).filter((item) => item.kind === 'bill_email')).toEqual([]);

    // Removed by mistake: the same file sent again is taken, not called a duplicate.
    reader.failWith = null;
    expect((await send({})).body.data).toEqual({ status: 'accepted', waiting: 1, duplicates: 0 });
  });

  it('should keep the dashboard routes for the people who run the shop', async () => {
    const staff = await loginAs(context, 'employee');
    expect((await api().get('/api/bill-emails').set({ Authorization: `Bearer ${staff}` })).status).toBe(403);
  });
});
