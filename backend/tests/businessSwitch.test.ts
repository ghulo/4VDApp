import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../src/database/connection.js';
import { defaultBusinessId } from '../src/database/business.js';
import { createBusiness } from '../src/database/newBusiness.js';
import { hashPassword } from '../src/utils/password.js';
import { verifyAccessToken } from '../src/utils/tokens.js';
import { createLiveLikeDatabase, createTestUser, loginAs, resetData, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers/testApp.js';

/**
 * Phase 5c: each business has its own powers grid, and someone in two
 * businesses (or 4VD's developer) switches between them with the picker. The
 * session keeps the business it switched to across refreshes, while the person
 * still belongs to it.
 */

let context: TestContext;
let live: DatabaseClient;
let shopId: number;
let otherId: number;
let thirdId: number;
let shopEmployee: string;
let otherEmployee: string;
let otherMainAdmin: string;
let shopMainAdmin: string;
/** A person whose home is the shop and who is also the other business's accountant. */
let both: { id: number; email: string };

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const signIn = async (email: string) => {
  const response = await request(context.app).post('/api/auth/login').send({ email, password: TEST_PASSWORD });
  if (response.status !== 200) throw new Error(`login ${email}: ${JSON.stringify(response.body)}`);
  return response.body.data as { token: string; refreshToken: string };
};
const businessOf = (token: string) => verifyAccessToken(token, context.config.jwtSecret)?.businessId;
const saveGrid = (token: string, powers: object) => request(context.app).put('/api/permissions').set(auth(token)).send({ powers, pages: {} });

beforeAll(async () => {
  context = await setupTestApp();
  await resetData(context.db);
  context.container.permissionService.forget();
  live = createLiveLikeDatabase();
  shopId = await defaultBusinessId(context.db);
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const person = (businessId: number, email: string, role: 'main_admin' | 'employee') =>
    context.db.insertInto('users').values({ email, name: email, role, password_hash: passwordHash, business_id: businessId, email_verified_at: new Date() }).execute();
  otherId = await createBusiness(live, 'Switch Furniture', async (_trx, businessId) => businessId);
  thirdId = await createBusiness(live, 'Switch Tiles', async (_trx, businessId) => businessId);
  await person(otherId, 'founder@switch.test', 'main_admin');
  await person(otherId, 'seller@switch.test', 'employee');

  shopMainAdmin = await loginAs(context, 'main_admin');
  shopEmployee = await loginAs(context, 'employee');
  otherMainAdmin = (await signIn('founder@switch.test')).token;
  otherEmployee = (await signIn('seller@switch.test')).token;

  const user = await createTestUser(context.db, 'owner', { email: 'both@test.local' });
  both = { id: user.id, email: user.email };
  await context.db.insertInto('memberships').values({ user_id: user.id, business_id: otherId, role: 'accountant' }).execute();
});
afterAll(async () => {
  // Leave both grids as usual for the next file on this database.
  await saveGrid(shopMainAdmin, {});
  await saveGrid(otherMainAdmin, {});
  context.container.permissionService.forget();
  await live.destroy();
  await context.db.destroy();
});

describe('a powers grid per business', () => {
  it('should apply a change only in the business that made it', async () => {
    expect((await request(context.app).get('/api/activity').set(auth(shopEmployee))).status).toBe(403);

    const saved = await saveGrid(shopMainAdmin, { oversee: ['admin', 'owner', 'employee'] });

    expect(saved.status).toBe(200);
    expect((await request(context.app).get('/api/activity').set(auth(shopEmployee))).status).toBe(200);
    expect((await request(context.app).get('/api/activity').set(auth(otherEmployee))).status).toBe(403);
    const otherGrid = await request(context.app).get('/api/permissions').set(auth(otherMainAdmin));
    expect(otherGrid.body.data.powers).toEqual(otherGrid.body.data.defaults);
  });

  it('should keep each business its own grid after the server reads them again', async () => {
    await saveGrid(otherMainAdmin, { sell: ['admin'] });
    context.container.permissionService.forget();

    const shopGrid = await request(context.app).get('/api/permissions').set(auth(shopMainAdmin));
    const otherGrid = await request(context.app).get('/api/permissions').set(auth(otherMainAdmin));

    expect(shopGrid.body.data.powers.oversee).toContain('employee');
    expect(shopGrid.body.data.powers.sell).toContain('employee');
    expect(otherGrid.body.data.powers.oversee).not.toContain('employee');
    expect(otherGrid.body.data.powers.sell).not.toContain('employee');
    expect((await request(context.app).post('/api/sales').set(auth(otherEmployee)).send({ productId: 1, quantity: 1 })).status).toBe(403);
  });
});

describe('switching business', () => {
  it('should list the businesses someone belongs to and switch the session into one', async () => {
    const session = await signIn(both.email);
    const me = await request(context.app).get('/api/auth/me').set(auth(session.token));
    expect(me.body.data.businessId).toBe(shopId);
    expect(me.body.data.businesses.map((business: { id: number }) => business.id).sort()).toEqual([shopId, otherId].sort());

    const switched = await request(context.app).post('/api/auth/switch').set(auth(session.token)).send({ businessId: otherId });

    expect(switched.status).toBe(200);
    expect(switched.body.data.user.role).toBe('accountant');
    expect(businessOf(switched.body.data.token)).toBe(otherId);
    const there = await request(context.app).get('/api/auth/me').set(auth(switched.body.data.token));
    expect(there.body.data.businessId).toBe(otherId);
    expect(there.body.data.role).toBe('accountant');
    // The session's old refresh token stopped working.
    expect((await request(context.app).post('/api/auth/refresh').send({ refreshToken: session.refreshToken })).status).toBe(401);
  });

  it('should stay in the switched business after a refresh', async () => {
    const session = await signIn(both.email);
    const switched = await request(context.app).post('/api/auth/switch').set(auth(session.token)).send({ businessId: otherId });

    const refreshed = await request(context.app).post('/api/auth/refresh').send({ refreshToken: switched.body.data.refreshToken });

    expect(refreshed.status).toBe(200);
    expect(businessOf(refreshed.body.data.token)).toBe(otherId);
  });

  it('should go back home when the person no longer belongs to the switched business', async () => {
    const session = await signIn(both.email);
    const switched = await request(context.app).post('/api/auth/switch').set(auth(session.token)).send({ businessId: otherId });
    await context.db.updateTable('memberships').set({ is_active: false }).where('user_id', '=', both.id).where('business_id', '=', otherId).execute();

    try {
      const refreshed = await request(context.app).post('/api/auth/refresh').send({ refreshToken: switched.body.data.refreshToken });
      expect(businessOf(refreshed.body.data.token)).toBe(shopId);
      // The token still naming the other business no longer opens it either.
      const me = await request(context.app).get('/api/auth/me').set(auth(switched.body.data.token));
      expect(me.body.data.businessId).toBe(shopId);
    } finally {
      await context.db.updateTable('memberships').set({ is_active: true }).where('user_id', '=', both.id).where('business_id', '=', otherId).execute();
    }
  });

  it('should refuse a business the person does not belong to', async () => {
    const session = await signIn(both.email);

    const response = await request(context.app).post('/api/auth/switch').set(auth(session.token)).send({ businessId: thirdId });

    expect(response.status).toBe(403);
    expect((await request(context.app).post('/api/auth/switch').set(auth(shopEmployee)).send({ businessId: otherId })).status).toBe(403);
  });

  it('should let 4VD\'s developer pick any business', async () => {
    const developer = await loginAs(context, 'developer');
    const me = await request(context.app).get('/api/auth/me').set(auth(developer));
    expect(me.body.data.businesses.map((business: { id: number }) => business.id)).toEqual(expect.arrayContaining([shopId, otherId, thirdId]));

    const switched = await request(context.app).post('/api/auth/switch').set(auth(developer)).send({ businessId: thirdId });

    expect(switched.status).toBe(200);
    expect(switched.body.data.user.role).toBe('developer');
    expect(businessOf(switched.body.data.token)).toBe(thirdId);
  });
});
