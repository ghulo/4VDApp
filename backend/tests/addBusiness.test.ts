import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runAsBusiness } from '../src/database/businessContext.js';
import type { DatabaseClient } from '../src/database/connection.js';
import type { BillPage, BillReader, BillReading } from '../src/services/ai/billReader.js';
import { createLiveLikeDatabase, createTestUser, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

/**
 * Phase 5d-2b: 4VD's developer adds businesses; each has its own bill address
 * (bills+<short>@4vd.app), reads its emailed bills in its own business, sees
 * the server backup, and a portal customer of two shops gets a link from each.
 */

class FakeReader implements BillReader {
  read(_pages: BillPage[]): Promise<BillReading> {
    return Promise.resolve({
      supplier: { name: 'Fresh Foods LLC', nui: '811234567' },
      number: 'FF-1',
      issuedOn: '2026-11-10',
      dueOn: null,
      pricesIncludeVat: false,
      lines: [],
      totals: { net: 10, vat: 1.8, gross: 11.8 },
      remarks: null,
    });
  }
}

const BILL_TOKEN = 'bill-email-test-token-123456';
const BACKUP_TOKEN = 'backup-test-token-123456789';
let context: TestContext;
let live: DatabaseClient;
let developer: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);
const add = (body: Record<string, unknown>, token = developer) => api().post('/api/businesses').set(auth(token)).send(body);
const inBusiness = <T>(id: number, work: () => Promise<T>) => runAsBusiness(id, work);

let mails = 0;
async function mail(to: string | undefined, from = 'admin@test.local') {
  mails += 1;
  const pdf = { name: `bill-${mails}.pdf`, mime: 'application/pdf', data: Buffer.from(`%PDF-1.4\nbill ${mails}\n`).toString('base64') };
  const response = await api()
    .post('/api/internal/bill-email')
    .set({ 'x-bill-email-token': BILL_TOKEN })
    .send({ messageId: `<m${mails}@mail>`, from, subject: 'Bill', files: [pdf], ...(to !== undefined && { to }) });
  await context.container.billEmailService.settled();
  return response;
}

beforeAll(async () => {
  context = await setupTestApp({ billReader: new FakeReader() }, { BILL_EMAIL_TOKEN: BILL_TOKEN, BILL_EMAIL_DAILY_READS: '5', BACKUP_PING_TOKEN: BACKUP_TOKEN });
  live = createLiveLikeDatabase();
});
beforeEach(async () => {
  await resetData(context.db);
  developer = await loginAs(context, 'developer');
});
afterAll(async () => {
  await live.destroy();
  await context.db.destroy();
});

describe('add business', () => {
  it('should make the business with its short name, NUI and legal form, log it there and invite its first main admin', async () => {
    const response = await add({ name: 'Market Dacaj', shortName: 'market-dacaj', nui: '811111112', legalForm: 'individual', mainAdminEmail: 'Boss@Market.test' });

    expect(response.status).toBe(201);
    const { id } = response.body.data;
    expect(response.body.data).toMatchObject({ name: 'Market Dacaj', shortName: 'market-dacaj', billAddress: 'bills+market-dacaj@4vd.app', invited: 'boss@market.test' });
    const business = await context.db.selectFrom('businesses').select(['short_name', 'nui', 'legal_form']).where('id', '=', id).executeTakeFirstOrThrow();
    expect(business).toEqual({ short_name: 'market-dacaj', nui: '811111112', legal_form: 'individual' });
    const logged = await inBusiness(id, () => live.selectFrom('activity_log').select('action').where('action', '=', 'business.created').execute());
    expect(logged).toHaveLength(1);
    const invite = await context.db.selectFrom('invites').select(['role', 'business_id']).where('email', '=', 'boss@market.test').executeTakeFirstOrThrow();
    expect(invite).toEqual({ role: 'main_admin', business_id: id });
    // The seed: a chart of accounts and a Shop floor, in the new business only.
    const floors = await inBusiness(id, () => live.selectFrom('stock_locations').select('name').execute());
    expect(floors.map((row) => row.name)).toEqual(['Shop floor']);
  });

  it('should start the business with one category in its language, so its first product can be added at once', async () => {
    const albanian = (await add({ name: 'Dyqani A', shortName: 'dyqani-a', legalForm: 'company' })).body.data.id;
    const english = (await add({ name: 'Shop B', shortName: 'shop-b', legalForm: 'company', language: 'en' })).body.data.id;
    const names = (id: number) => inBusiness(id, () => live.selectFrom('categories').select('name').execute()).then((rows) => rows.map((row) => row.name));
    expect(await names(albanian)).toEqual(['Të ndryshme']);
    expect(await names(english)).toEqual(['Other']);
  });

  it('should refuse a short name another business uses, and a badly formed one', async () => {
    expect((await add({ name: 'One', shortName: 'corner', legalForm: 'company' })).status).toBe(201);

    const taken = await add({ name: 'Two', shortName: 'corner', legalForm: 'company' });
    const bad = await add({ name: 'Three', shortName: 'Corner Shop!', legalForm: 'company' });

    expect(taken.status).toBe(409);
    expect(taken.body.message).toContain('bills+corner@4vd.app');
    expect(bad.status).toBe(400);
  });

  it("should let only 4VD's developer change the short name", async () => {
    const admin = await loginAs(context, 'main_admin');
    expect((await api().put('/api/business').set(auth(admin)).send({ shortName: 'new-name' })).status).toBe(403);

    const changed = await api().put('/api/business').set(auth(developer)).send({ shortName: 'new-name' });

    expect(changed.status).toBe(200);
    expect(changed.body.data.billAddress).toBe('bills+new-name@4vd.app');
    expect((await api().get('/api/bill-emails/settings').set(auth(developer))).body.data.address).toBe('bills+new-name@4vd.app');
  });
});

describe('bill address per business', () => {
  it('should take plain bills@ (or no address) into the first business and bills+<short>@ into that business', async () => {
    const other = (await add({ name: 'Bakery', shortName: 'bakery', legalForm: 'company' })).body.data.id as number;
    const baker = await createTestUser(context.db, 'employee', { email: 'baker@bakery.test' });
    await context.db.insertInto('memberships').values({ user_id: baker.id, business_id: other, role: 'owner' }).execute();
    await createTestUser(context.db, 'admin', { email: 'admin@test.local' });

    expect((await mail('bills@4vd.app')).body.data.status).toBe('accepted');
    expect((await mail(undefined)).body.data.status).toBe('accepted');
    const there = await mail('Bills+Bakery@4vd.app', 'baker@bakery.test');

    expect(there.status).toBe(202);
    expect(there.body.data.status).toBe('accepted');
    const first = await context.db.selectFrom('bill_emails').select('id').execute();
    const bakery = await inBusiness(other, () => live.selectFrom('bill_emails').select(['status', 'business_id']).execute());
    expect(first).toHaveLength(2);
    expect(bakery).toEqual([{ status: 'read', business_id: other }]);
    // Read in the bakery, inside the bakery: its scan is there too.
    const scans = await inBusiness(other, () => live.selectFrom('bill_scans').select('business_id').execute());
    expect(scans).toEqual([{ business_id: other }]);
  });

  it("should trust only the business's own people: someone from another business is ignored", async () => {
    await add({ name: 'Bakery', shortName: 'bakery', legalForm: 'company' });
    await createTestUser(context.db, 'admin', { email: 'admin@test.local' });

    const response = await mail('bills+bakery@4vd.app', 'admin@test.local');

    expect(response.body.data.status).toBe('ignored');
  });

  it('should answer an unknown short name so the worker can tell the sender', async () => {
    const response = await mail('bills+nobody@4vd.app');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('UNKNOWN_BILL_ADDRESS');
  });
});

describe('the server backup', () => {
  it('should count for every business', async () => {
    const other = (await add({ name: 'Bakery', shortName: 'bakery', legalForm: 'company' })).body.data.id as number;

    expect((await api().post('/api/internal/backup-ok').set({ 'x-backup-token': BACKUP_TOKEN })).status).toBe(200);

    const key = 'last_backup_at';
    const here = await context.db.selectFrom('settings').select('key').where('key', '=', key).execute();
    const there = await inBusiness(other, () => live.selectFrom('settings').select('key').where('key', '=', key).execute());
    expect(here).toHaveLength(1);
    expect(there).toHaveLength(1);
  });
});
