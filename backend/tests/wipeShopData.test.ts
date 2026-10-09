import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WIPE_PHRASE, wipeShopData } from '../src/scripts/wipeShopData.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
});
afterAll(() => context.db.destroy());

const count = async (table: 'users' | 'products' | 'sales' | 'activity_log' | 'categories' | 'businesses' | 'settings') =>
  Number((await context.db.selectFrom(table).select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow()).n);

/** A shop with a developer, an employee who sold something, and test products. */
async function shopWithTestData() {
  const developerToken = await loginAs(context, 'developer');
  const employeeToken = await loginAs(context, 'employee');
  const productId = await createTestProduct(context, developerToken, { stock: 20 });
  await request(context.app).post('/api/sales').set({ Authorization: `Bearer ${employeeToken}` }).send({ productId, quantity: 2 });
  return { developerToken };
}

describe('wipeShopData', () => {
  it('should only report what it would delete on a dry run', async () => {
    await shopWithTestData();

    const report = await wipeShopData(context.db, { apply: false });

    expect(report.applied).toBe(false);
    expect(report.deleted.users).toBe(1);
    expect(report.deleted.sales).toBe(1);
    expect(await count('users')).toBe(2);
    expect(await count('sales')).toBe(1);
  });

  it('should delete everything except developer accounts, the shop and its settings', async () => {
    const { developerToken } = await shopWithTestData();

    const report = await wipeShopData(context.db, { apply: true });
    const me = await request(context.app).get('/api/auth/me').set({ Authorization: `Bearer ${developerToken}` });

    expect(report.applied).toBe(true);
    expect(report.keptDevelopers).toEqual(['developer@test.local']);
    expect(await count('users')).toBe(1);
    expect(await count('products')).toBe(0);
    expect(await count('categories')).toBe(0);
    expect(await count('sales')).toBe(0);
    expect(await count('activity_log')).toBe(0);
    expect(await count('businesses')).toBe(1);
    expect(await count('settings')).toBeGreaterThan(0);
    expect(me.status).toBe(200);
  });

  it('should refuse to run when there is no developer to keep', async () => {
    await loginAs(context, 'admin');

    await expect(wipeShopData(context.db, { apply: true })).rejects.toThrow(/no developer/i);
    expect(await count('users')).toBe(1);
  });

  it('should name the phrase that has to be typed to really delete', () => {
    expect(WIPE_PHRASE).toBe('wipe 4vd.app');
  });
});

describe('wipe from the dashboard', () => {
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('should be for the developer only', async () => {
    const adminToken = await loginAs(context, 'admin');
    const ownerToken = await loginAs(context, 'owner');

    for (const token of [adminToken, ownerToken]) {
      expect((await request(context.app).get('/api/settings/wipe-preview').set(auth(token))).status).toBe(403);
      expect((await request(context.app).post('/api/settings/wipe').set(auth(token)).send({ confirm: WIPE_PHRASE })).status).toBe(403);
    }
  });

  it('should show what would go, without deleting anything', async () => {
    const { developerToken } = await shopWithTestData();

    const preview = await request(context.app).get('/api/settings/wipe-preview').set(auth(developerToken));

    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({ applied: false, keptDevelopers: ['developer@test.local'], deleted: { users: 1, sales: 1 } });
    expect(await count('sales')).toBe(1);
  });

  it('should delete nothing unless the phrase is typed exactly', async () => {
    const { developerToken } = await shopWithTestData();

    for (const body of [{}, { confirm: 'wipe' }, { confirm: 'WIPE 4VD.APP' }]) {
      expect((await request(context.app).post('/api/settings/wipe').set(auth(developerToken)).send(body)).status).toBe(400);
    }
    expect(await count('sales')).toBe(1);
  });

  it('should wipe everything, tick the launch step, keep the carwashes and log it', async () => {
    const { developerToken } = await shopWithTestData();
    await request(context.app).put('/api/carwash/2026-10-01').set(auth(developerToken)).send({ carwash: 10, change: 0 });

    const wiped = await request(context.app).post('/api/settings/wipe').set(auth(developerToken)).send({ confirm: WIPE_PHRASE });

    expect(wiped.status).toBe(200);
    expect(await count('sales')).toBe(0);
    expect(await count('users')).toBe(1);
    expect(await context.db.selectFrom('carwash_days').select('day').execute()).toHaveLength(0);
    expect(await context.db.selectFrom('carwashes').select('id').execute()).toHaveLength(1);
    const checklist = await request(context.app).get('/api/settings/launch-checklist').set(auth(developerToken));
    expect(checklist.body.data.find((step: { key: string }) => step.key === 'wiped').done).toBe(true);
    const log = await context.db.selectFrom('activity_log').select('action').execute();
    expect(log.map((entry) => entry.action)).toEqual(['shop.wiped']);
  });
});
