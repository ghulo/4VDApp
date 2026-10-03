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
