import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../src/database/connection.js';
import { runAsBusiness } from '../src/database/businessContext.js';
import { defaultBusinessId } from '../src/database/business.js';
import { createBusiness } from '../src/database/newBusiness.js';
import { NotificationRepository } from '../src/repositories/NotificationRepository.js';
import { UserRepository } from '../src/repositories/UserRepository.js';
import { hashPassword } from '../src/utils/password.js';
import { verifyAccessToken } from '../src/utils/tokens.js';
import { createLiveLikeDatabase, createTestUser, loginAs, resetData, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers/testApp.js';

/**
 * Phase 5d: someone in two businesses has a role and access in each (the
 * `people` view reads memberships of the business open now). Each business
 * changes only their place in it; the account itself (name, password, sign-in)
 * belongs to their home business. Inviting someone who already has an account
 * adds them with it.
 */

let context: TestContext;
let live: DatabaseClient;
let shopId: number;
let otherId: number;
let shopMainAdmin: string;
let otherMainAdmin: string;
/** Home: the shop, as admin. Also the other business's employee. */
let pat: { id: number; email: string };

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const signIn = async (email: string) => {
  const response = await request(context.app).post('/api/auth/login').send({ email, password: TEST_PASSWORD });
  if (response.status !== 200) throw new Error(`login ${email}: ${JSON.stringify(response.body)}`);
  return response.body.data as { token: string };
};
const listIn = async (token: string) =>
  (await request(context.app).get('/api/users?limit=100').set(auth(token))).body.data as Array<{ id: number; email: string; role: string; homeHere: boolean }>;
const membership = (businessId: number) =>
  context.db.selectFrom('memberships').selectAll().where('user_id', '=', pat.id).where('business_id', '=', businessId).executeTakeFirstOrThrow();
const tokenFrom = async (to: string) => {
  const email = await context.db.selectFrom('email_outbox').select('text').where('to_address', '=', to).orderBy('id', 'desc').executeTakeFirstOrThrow();
  return /https?:\/\/\S+/.exec(email.text)![0].split('/').at(-1)!;
};

beforeAll(async () => {
  context = await setupTestApp();
  await resetData(context.db);
  live = createLiveLikeDatabase();
  shopId = await defaultBusinessId(context.db);
  otherId = await createBusiness(live, 'People Two', async (_trx, businessId) => businessId);
  await context.db
    .insertInto('users')
    .values({ email: 'founder@two.test', name: 'Founder', role: 'main_admin', password_hash: await hashPassword(TEST_PASSWORD), business_id: otherId, email_verified_at: new Date() })
    .execute();

  shopMainAdmin = await loginAs(context, 'main_admin');
  otherMainAdmin = (await signIn('founder@two.test')).token;
  const user = await createTestUser(context.db, 'admin', { email: 'pat@test.local' });
  pat = { id: user.id, email: user.email };
  await context.db.insertInto('memberships').values({ user_id: pat.id, business_id: otherId, role: 'employee' }).execute();
});
afterAll(async () => {
  await live.destroy();
  await context.db.destroy();
});

describe('the people view', () => {
  it('should have every column of users (recreate it when users gets one)', async () => {
    const columns = (table: string) =>
      sql<{ column_name: string }>`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table}`
        .execute(context.db)
        .then((result) => result.rows.map((row) => row.column_name).sort());

    expect(await columns('people')).toEqual(await columns('users'));
  });
});

describe('someone in two businesses', () => {
  it('should be listed in each business with the role they have there', async () => {
    const inOther = await listIn(otherMainAdmin);
    const inShop = await listIn(shopMainAdmin);

    expect(inOther.find((person) => person.id === pat.id)).toMatchObject({ role: 'employee', homeHere: false });
    expect(inOther.find((person) => person.email === 'founder@two.test')).toMatchObject({ homeHere: true });
    expect(inShop.find((person) => person.id === pat.id)).toMatchObject({ role: 'admin', homeHere: true });
    expect(inShop.some((person) => person.email === 'founder@two.test')).toBe(false);
  });

  it('should change their role only in the business that changes it', async () => {
    const changed = await request(context.app).put(`/api/users/${pat.id}`).set(auth(otherMainAdmin)).send({ role: 'owner' });

    expect(changed.status).toBe(200);
    expect(changed.body.data.role).toBe('owner');
    expect((await membership(otherId)).role).toBe('owner');
    expect((await membership(shopId)).role).toBe('admin');
    expect((await listIn(shopMainAdmin)).find((person) => person.id === pat.id)?.role).toBe('admin');
  });

  it('should tell each business only about its own people with a role', async () => {
    const users = new UserRepository(live);
    const notifications = new NotificationRepository(live);
    const notice = { type: 'test', write: () => ({ title: 'Hello owners', message: 'm' }) };

    const inOther = await runAsBusiness(otherId, () => notifications.createForRoles(['owner'], notice));
    const inShop = await runAsBusiness(shopId, () => notifications.createForRoles(['owner'], notice));
    const owners = await runAsBusiness(otherId, () => users.countActive(['owner']));
    const got = (businessId: number) =>
      runAsBusiness(businessId, () => live.selectFrom('notifications').select('id').where('user_id', '=', pat.id).where('title', '=', 'Hello owners').execute());

    expect(inOther).toBe(1);
    expect(inShop).toBe(0);
    expect(owners).toBe(1);
    expect(await got(otherId)).toHaveLength(1);
    expect(await got(shopId)).toHaveLength(0);
  });

  it("should refuse changes to the account itself outside their home business", async () => {
    const put = (body: object) => request(context.app).put(`/api/users/${pat.id}`).set(auth(otherMainAdmin)).send(body);

    expect((await put({ name: 'Renamed' })).status).toBe(403);
    expect((await put({ password: 'a-long-new-password' })).status).toBe(403);
    expect((await put({ monthlyTarget: 100 })).status).toBe(403);
    expect((await request(context.app).post(`/api/users/${pat.id}/two-step/reset`).set(auth(otherMainAdmin)).send({})).status).toBe(403);
    expect((await request(context.app).post(`/api/users/${pat.id}/passkeys/reset`).set(auth(otherMainAdmin))).status).toBe(403);
    const account = await context.db.selectFrom('users').select(['name']).where('id', '=', pat.id).executeTakeFirstOrThrow();
    expect(account.name).toBe('Test admin');
  });

  it("should show someone's devices only to a business they work for", async () => {
    const founder = await runAsBusiness(otherId, () => live.selectFrom('users').select('id').where('email', '=', 'founder@two.test').executeTakeFirstOrThrow());

    expect((await request(context.app).get(`/api/users/${founder.id}/sessions`).set(auth(shopMainAdmin))).status).toBe(404);
    expect((await request(context.app).get(`/api/users/${pat.id}/sessions`).set(auth(otherMainAdmin))).status).toBe(200);
  });

  it('should count main admins per business', async () => {
    const users = new UserRepository(live);
    await request(context.app).put(`/api/users/${pat.id}`).set(auth(otherMainAdmin)).send({ role: 'main_admin' });

    const inOther = await runAsBusiness(otherId, () => users.countActive(['main_admin']));
    const inShop = await runAsBusiness(shopId, () => users.countActive(['main_admin']));

    expect([inOther, inShop]).toEqual([2, 1]);
    expect((await request(context.app).put(`/api/users/${pat.id}`).set(auth(otherMainAdmin)).send({ role: 'owner' })).status).toBe(200);
  });

  it("should keep the Counter in its business when someone from another business takes it over with a PIN", async () => {
    await context.db
      .insertInto('users')
      .values({ email: 'seller@two.test', name: 'Seller', role: 'employee', password_hash: await hashPassword(TEST_PASSWORD), business_id: otherId, email_verified_at: new Date() })
      .execute();
    const seller = await signIn('seller@two.test');
    const patHome = await signIn(pat.email);
    expect((await request(context.app).put('/api/me/pin').set(auth(patHome.token)).send({ password: TEST_PASSWORD, pin: '2580' })).status).toBe(200);

    const people = await request(context.app).get('/api/counter/pin-people').set(auth(seller.token));
    const switched = await request(context.app).post('/api/counter/switch').set(auth(seller.token)).send({ userId: pat.id, pin: '2580' });

    expect(people.body.data.find((person: { id: number }) => person.id === pat.id)).toMatchObject({ role: 'owner' });
    expect(switched.status).toBe(200);
    expect(verifyAccessToken(switched.body.data.token, context.config.jwtSecret)?.businessId).toBe(otherId);
    expect(switched.body.data.user.role).toBe('owner');
  });

  it('should block them in one business and leave the other alone', async () => {
    const patSignIn = await signIn(pat.email);
    const inOther = await request(context.app).post('/api/auth/switch').set(auth(patSignIn.token)).send({ businessId: otherId });
    const blocked = await request(context.app).put(`/api/users/${pat.id}`).set(auth(otherMainAdmin)).send({ isActive: false });

    expect(blocked.status).toBe(200);
    // A tab still open in the other business can't carry on, not even in their home business.
    const stale = await request(context.app).put('/api/me/profile').set(auth(inOther.body.data.token)).send({ theme: 'dark' });
    expect(stale.status).toBe(401);
    expect(stale.body.error).toBe('BUSINESS_GONE');
    expect((await membership(otherId)).is_active).toBe(false);
    expect((await membership(shopId)).is_active).toBe(true);
    const me = await request(context.app).get('/api/auth/me').set(auth((await signIn(pat.email)).token));
    expect(me.body.data.businesses.map((business: { id: number }) => business.id)).toEqual([shopId]);
    await request(context.app).put(`/api/users/${pat.id}`).set(auth(otherMainAdmin)).send({ isActive: true });
  });

  it('should take them off a business without deleting their account', async () => {
    const removed = await request(context.app).delete(`/api/users/${pat.id}`).set(auth(otherMainAdmin));

    expect(removed.status).toBe(200);
    expect((await membership(otherId)).removed_at).not.toBeNull();
    expect((await listIn(otherMainAdmin)).some((person) => person.id === pat.id)).toBe(false);
    const account = await context.db.selectFrom('users').select(['deleted_at', 'is_active']).where('id', '=', pat.id).executeTakeFirstOrThrow();
    expect(account).toEqual({ deleted_at: null, is_active: true });
    expect((await signIn(pat.email)).token).toBeTruthy();
  });
});

describe('inviting someone who already has an account', () => {
  it('should not say at invite time that the email has an account', async () => {
    const invited = await request(context.app).post('/api/invites').set(auth(otherMainAdmin)).send({ email: pat.email, role: 'accountant' });

    expect(invited.status).toBe(201);
  });

  it('should refuse to invite someone who already works there', async () => {
    const invited = await request(context.app).post('/api/invites').set(auth(otherMainAdmin)).send({ email: 'founder@two.test', role: 'employee' });

    expect(invited.status).toBe(409);
  });

  it('should ask the person holding the link to log in instead of choosing a password', async () => {
    const token = await tokenFrom(pat.email);

    const preview = await request(context.app).get(`/api/auth/invites/${token}`);
    const accepted = await request(context.app).post(`/api/auth/invites/${token}/accept`).send({ name: 'Someone', password: 'a-long-password' });

    expect(preview.body.data).toMatchObject({ shopName: 'People Two', hasAccount: true });
    expect(accepted.status).toBe(409);
    expect(accepted.body.error).toBe('INVITE_HAS_ACCOUNT');
  });

  it('should refuse to let a different account join with the link', async () => {
    const token = await tokenFrom(pat.email);

    const joined = await request(context.app).post(`/api/auth/invites/${token}/join`).set(auth(shopMainAdmin));

    expect(joined.status).toBe(403);
  });

  it('should add the signed-in person to the business and open it, with nothing else about the account changed', async () => {
    const token = await tokenFrom(pat.email);
    const before = await context.db.selectFrom('users').select(['name', 'password_hash', 'role']).where('id', '=', pat.id).executeTakeFirstOrThrow();

    const joined = await request(context.app).post(`/api/auth/invites/${token}/join`).set(auth((await signIn(pat.email)).token));

    expect(joined.status).toBe(200);
    expect(verifyAccessToken(joined.body.data.token, context.config.jwtSecret)?.businessId).toBe(otherId);
    expect(joined.body.data.user.role).toBe('accountant');
    expect(await membership(otherId)).toMatchObject({ role: 'accountant', is_active: true, removed_at: null });
    expect(await context.db.selectFrom('users').select(['name', 'password_hash', 'role']).where('id', '=', pat.id).executeTakeFirstOrThrow()).toEqual(before);
    const logged = (businessId: number) =>
      runAsBusiness(businessId, () => live.selectFrom('activity_log').select('id').where('action', '=', 'user.joined').where('user_id', '=', pat.id).execute());
    expect(await logged(otherId)).toHaveLength(1);
    expect(await logged(shopId)).toHaveLength(0);
    expect((await request(context.app).post(`/api/auth/invites/${token}/join`).set(auth((await signIn(pat.email)).token))).status).toBe(410);
  });
});
