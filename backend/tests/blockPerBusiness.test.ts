import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../src/database/connection.js';
import { defaultBusinessId } from '../src/database/business.js';
import { createBusiness } from '../src/database/newBusiness.js';
import { hashPassword } from '../src/utils/password.js';
import { verifyAccessToken } from '../src/utils/tokens.js';
import { createLiveLikeDatabase, createTestUser, loginAs, resetData, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers/testApp.js';

/**
 * Phase 5d-2: blocking someone, even in their home business, blocks only their
 * place in that business; only deleting the account locks them out
 * everywhere, and that is refused while they are the only main admin of
 * another business.
 */

let context: TestContext;
let live: DatabaseClient;
let shopId: number;
let otherId: number;
let shopMainAdmin: string;
/** Home: the shop, as employee. The only main admin of the other business. */
let sam: { id: number; email: string };

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const login = (email: string) => request(context.app).post('/api/auth/login').send({ email, password: TEST_PASSWORD });
const businessOf = (token: string) => verifyAccessToken(token, context.config.jwtSecret)?.businessId;
const membership = (businessId: number) =>
  context.db.selectFrom('memberships').select(['role', 'is_active']).where('user_id', '=', sam.id).where('business_id', '=', businessId).executeTakeFirstOrThrow();
const change = (body: object) => request(context.app).put(`/api/users/${sam.id}`).set(auth(shopMainAdmin)).send(body);

beforeAll(async () => {
  context = await setupTestApp();
  await resetData(context.db);
  live = createLiveLikeDatabase();
  shopId = await defaultBusinessId(context.db);
  otherId = await createBusiness(live, 'Sam Bakery', async (_trx, businessId) => businessId);
  shopMainAdmin = await loginAs(context, 'main_admin');
  const user = await createTestUser(context.db, 'employee', { email: 'sam@test.local' });
  sam = { id: user.id, email: user.email };
  await context.db.insertInto('memberships').values({ user_id: sam.id, business_id: otherId, role: 'main_admin' }).execute();
});
afterAll(async () => {
  await live.destroy();
  await context.db.destroy();
});

describe('blocking at home', () => {
  it('should block only the home business, and sign-in opens the other one', async () => {
    const blocked = await change({ isActive: false });

    expect(blocked.status).toBe(200);
    expect(await membership(shopId)).toMatchObject({ is_active: false });
    expect(await membership(otherId)).toMatchObject({ is_active: true });
    const account = await context.db.selectFrom('users').select('is_active').where('id', '=', sam.id).executeTakeFirstOrThrow();
    expect(account.is_active).toBe(true);
    const signedIn = await login(sam.email);
    expect(signedIn.status).toBe(200);
    expect(businessOf(signedIn.body.data.token)).toBe(otherId);
  });

  it('should keep the block when their role at home changes', async () => {
    expect((await change({ role: 'owner' })).status).toBe(200);

    expect(await membership(shopId)).toEqual({ role: 'owner', is_active: false });
  });

  it('should open the home business again once allowed', async () => {
    await change({ isActive: true });

    expect(await membership(shopId)).toMatchObject({ is_active: true });
    expect(businessOf((await login(sam.email)).body.data.token)).toBe(shopId);
  });

  it('should refuse a sign-in when they are blocked in every business', async () => {
    await change({ isActive: false });
    await context.db.updateTable('memberships').set({ is_active: false }).where('user_id', '=', sam.id).where('business_id', '=', otherId).execute();

    try {
      expect((await login(sam.email)).status).toBe(401);
    } finally {
      await context.db.updateTable('memberships').set({ is_active: true }).where('user_id', '=', sam.id).execute();
    }
  });
});

describe('deleting the account', () => {
  it('should refuse while they are the only main admin of another business, and name it', async () => {
    const removed = await request(context.app).delete(`/api/users/${sam.id}`).set(auth(shopMainAdmin));

    expect(removed.status).toBe(409);
    expect(removed.body.message).toContain('Sam Bakery');
  });

  it('should delete the account, locking them out everywhere, once the other business has another main admin', async () => {
    await context.db
      .insertInto('users')
      .values({ email: 'baker@bakery.test', name: 'Baker', role: 'main_admin', password_hash: await hashPassword(TEST_PASSWORD), business_id: otherId, email_verified_at: new Date() })
      .execute();

    const removed = await request(context.app).delete(`/api/users/${sam.id}`).set(auth(shopMainAdmin));

    expect(removed.status).toBe(200);
    expect((await login(sam.email)).status).toBe(401);
  });
});
