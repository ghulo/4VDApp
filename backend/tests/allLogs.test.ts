import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runAsBusiness } from '../src/database/businessContext.js';
import { createDatabase, type DatabaseClient } from '../src/database/connection.js';
import { createTestUser, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

/**
 * Phase 5e: All logs. Only 4VD's developer reads every business's history and
 * the support visits; the database functions check the flag themselves, take
 * the signed-in user only, and log each read. The app's own role still can't
 * read across businesses by any switch.
 */

/** Like fourvd_app live: an ordinary role that owns nothing, with the same grants. */
const APP_ROLE = 'four_vd_app_tester_app';

let context: TestContext;
let admin: DatabaseClient;
let asApp: DatabaseClient;
let developer: string;
let developerId: number;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);
const reads = () => context.db.selectFrom('all_logs_reads').select(['developer_id', 'kind', 'filters']).orderBy('id').execute();

beforeAll(async () => {
  context = await setupTestApp();
  admin = createDatabase(context.config.databaseUrl, { poolSize: 1 });
  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sql.lit(APP_ROLE)}) THEN
        CREATE ROLE ${sql.raw(APP_ROLE)} NOLOGIN NOSUPERUSER NOBYPASSRLS;
      END IF;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
    END $$
  `.execute(admin);
  await sql`GRANT USAGE ON SCHEMA public TO ${sql.raw(APP_ROLE)}`.execute(admin);
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${sql.raw(APP_ROLE)}`.execute(admin);
  await sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${sql.raw(APP_ROLE)}`.execute(admin);
  // Live, the app's role gets EXECUTE on new functions from the owner's default privileges.
  await sql`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${sql.raw(APP_ROLE)}`.execute(admin);
  asApp = createDatabase(context.config.databaseUrl, { role: APP_ROLE, poolSize: 2 });
});
beforeEach(async () => {
  await resetData(context.db);
  await context.db.deleteFrom('all_logs_reads').execute();
  developer = await loginAs(context, 'developer');
  developerId = (await context.db.selectFrom('users').select('id').where('email', '=', 'developer@test.local').executeTakeFirstOrThrow()).id;
});
afterAll(async () => {
  await asApp.destroy();
  await admin.destroy();
  await context.db.destroy();
});

async function addBakery(): Promise<number> {
  const response = await api().post('/api/businesses').set(auth(developer)).send({ name: 'Bakery', shortName: 'bakery', legalForm: 'company' });
  expect(response.status).toBe(201);
  return response.body.data.id as number;
}

describe('all logs for the developer', () => {
  it("should list every business's history, newest first, each with its business", async () => {
    const bakery = await addBakery();
    await runAsBusiness(1, () =>
      context.db.insertInto('activity_log').values({ action: 'category.created', summary: 'Created category Vases', entity_type: null, entity_id: null, user_id: developerId }).execute(),
    );

    const response = await api().get('/api/all-logs/activity').set(auth(developer));

    expect(response.status).toBe(200);
    const businesses = new Set(response.body.data.map((row: { business: { id: number } }) => row.business.id));
    expect(businesses).toEqual(new Set([1, bakery]));
    const created = response.body.data.find((row: { action: string }) => row.action === 'business.created');
    expect(created).toMatchObject({ business: { id: bakery, name: 'Bakery' }, user: { id: developerId, isDeveloper: true } });
    expect(response.body.meta.total).toBe(response.body.data.length);
  });

  it('should filter by business, kind and words (a business name counts as a word)', async () => {
    const bakery = await addBakery();
    await runAsBusiness(1, () =>
      context.db.insertInto('activity_log').values({ action: 'category.created', summary: 'Created category Vases', entity_type: null, entity_id: null, user_id: null }).execute(),
    );

    const onlyBakery = await api().get('/api/all-logs/activity').query({ businessId: bakery }).set(auth(developer));
    const onlyCategories = await api().get('/api/all-logs/activity').query({ action: 'category' }).set(auth(developer));
    const byName = await api().get('/api/all-logs/activity').query({ search: 'bakery' }).set(auth(developer));

    expect(onlyBakery.body.data.every((row: { business: { id: number } }) => row.business.id === bakery)).toBe(true);
    expect(onlyBakery.body.data.length).toBeGreaterThan(0);
    expect(onlyCategories.body.data.map((row: { summary: string }) => row.summary)).toEqual(['Created category Vases']);
    // Every row of the bakery, and the category in business 1 isn't among them.
    expect(byName.body.data.some((row: { business: { id: number } }) => row.business.id === bakery)).toBe(true);
    expect(byName.body.data.some((row: { summary: string }) => row.summary === 'Created category Vases')).toBe(false);
  });

  it('should list support visits across businesses with the changes made in each', async () => {
    const bakery = await addBakery();

    const response = await api().get('/api/all-logs/support').set(auth(developer));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({ business: { id: bakery, name: 'Bakery' }, developer: expect.objectContaining({ id: developerId }), reason: 'Created the business', actions: [] }),
    ]);
  });

  it('should log each read with who read it and the filters', async () => {
    await api().get('/api/all-logs/activity').query({ action: 'stock', search: 'vase' }).set(auth(developer));
    await api().get('/api/all-logs/support').set(auth(developer));

    const logged = await reads();
    expect(logged).toEqual([
      { developer_id: developerId, kind: 'activity', filters: expect.objectContaining({ actions: ['stock'], words: ['vase'] }) },
      { developer_id: developerId, kind: 'support', filters: expect.objectContaining({ business: null }) },
    ]);
  });
});

describe('no one else', () => {
  it("should refuse a business's own main admin, even naming the developer's id", async () => {
    const mainAdmin = await loginAs(context, 'main_admin');

    for (const path of ['/api/all-logs/activity', '/api/all-logs/support', '/api/all-logs/businesses']) {
      const response = await api().get(path).query({ userId: developerId, developerId }).set(auth(mainAdmin));
      expect(response.status).toBe(403);
    }
    expect(await reads()).toEqual([]);
  });

  it('should take nothing from the request but the filters: a user id is refused', async () => {
    const response = await api().get('/api/all-logs/activity').query({ userId: developerId }).set(auth(developer));

    expect(response.status).toBe(400);
    expect(await reads()).toEqual([]);
  });

  it("should have the database refuse anyone but the developer, and the app's role read across nothing", async () => {
    const owner = (await createTestUser(context.db, 'main_admin')).id;
    await addBakery();

    const call = (id: number) => runAsBusiness(1, () => sql`select count(*) from all_activity(${id}::int, null, null, null, null, 50, 0)`.execute(asApp));
    await expect(call(owner)).rejects.toThrow('All logs are for the 4VD developer only');
    await expect(call(999999)).rejects.toThrow('All logs are for the 4VD developer only');

    // The function's own switch doesn't leak: afterwards, the app's role still sees only its business.
    const seen = await runAsBusiness(1, () =>
      asApp.transaction().execute(async (trx) => {
        await sql`select count(*) from all_activity(${developerId}::int, null, null, null, null, 50, 0)`.execute(trx);
        await sql`select set_config('app.maintenance', 'on', true), set_config('app.system', 'on', true)`.execute(trx);
        return trx.selectFrom('activity_log').select('business_id').distinct().execute();
      }),
    );
    expect(seen.map((row) => row.business_id)).toEqual([1]);
  });
});
