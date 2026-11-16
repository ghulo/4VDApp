import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, resetData, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers/testApp.js';

/**
 * The dashboard signs in with httpOnly cookies. A page script never sees a
 * token, and a change made with the cookie must come from our own pages.
 */
let context: TestContext;
const OURS = 'http://localhost:5173';
const OTHER = 'https://evil.example';

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(() => resetData(context.db));
afterAll(() => context.db.destroy());

function cookiesOf(response: request.Response): Record<string, string> {
  const raw = response.headers['set-cookie'] as unknown as string[] | undefined;
  const out: Record<string, string> = {};
  for (const line of raw ?? []) {
    const [pair] = line.split(';');
    const at = pair!.indexOf('=');
    out[pair!.slice(0, at)] = line;
  }
  return out;
}
const valueOf = (line: string | undefined) => line?.split(';')[0]!.split('=').slice(1).join('=') ?? '';

async function browserLogin(role: 'owner' | 'admin' = 'owner') {
  await createTestUser(context.db, role);
  const response = await request(context.app)
    .post('/api/auth/login')
    .set('Origin', OURS)
    .send({ email: `${role}@test.local`, password: TEST_PASSWORD });
  const cookies = cookiesOf(response);
  return { response, access: valueOf(cookies.vd_access), refresh: valueOf(cookies.vd_refresh), cookies };
}

describe('dashboard sign-in cookies', () => {
  it('sets httpOnly, Secure, SameSite=Lax cookies and keeps the tokens out of the page', async () => {
    const { response, cookies } = await browserLogin();

    expect(response.status).toBe(200);
    expect(response.body.data.token).toBeUndefined();
    expect(response.body.data.refreshToken).toBeUndefined();
    expect(response.body.data.user.email).toBe('owner@test.local');
    for (const name of ['vd_access', 'vd_refresh']) {
      expect(cookies[name]).toMatch(/HttpOnly/i);
      expect(cookies[name]).toMatch(/Secure/i);
      expect(cookies[name]).toMatch(/SameSite=Lax/i);
      expect(cookies[name]).toMatch(/Max-Age=\d+/i);
      expect(cookies[name]).not.toMatch(/Domain=/i);
    }
    expect(cookies.vd_access).toMatch(/Path=\/api(;|$)/);
    expect(cookies.vd_refresh).toMatch(/Path=\/api\/auth(;|$)/);
  });

  it('still hands tokens to scripts that are not browsers', async () => {
    await createTestUser(context.db, 'owner');
    const response = await request(context.app).post('/api/auth/login').send({ email: 'owner@test.local', password: TEST_PASSWORD });
    expect(response.body.data.token).toEqual(expect.any(String));
  });

  it('reads with the cookie, from any page of ours', async () => {
    const { access } = await browserLogin();
    const me = await request(context.app).get('/api/auth/me').set('Cookie', `vd_access=${access}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe('owner@test.local');
  });

  it('accepts a change with the cookie from our own page', async () => {
    const { access } = await browserLogin('admin');
    const response = await request(context.app)
      .post('/api/categories')
      .set('Origin', OURS)
      .set('Cookie', `vd_access=${access}`)
      .send({ name: 'Garden' });
    expect(response.status).toBe(201);
  });

  it('refuses a change from another site, even with a valid cookie', async () => {
    const { access } = await browserLogin('admin');
    const response = await request(context.app)
      .post('/api/categories')
      .set('Origin', OTHER)
      .set('Cookie', `vd_access=${access}`)
      .send({ name: 'Garden' });
    expect(response.status).toBe(403);
  });

  it('ignores the cookie on a change that says nothing about where it comes from', async () => {
    const { access } = await browserLogin();
    const response = await request(context.app).post('/api/categories').set('Cookie', `vd_access=${access}`).send({ name: 'Garden' });
    expect(response.status).toBe(401);
  });

  it('refuses a sign-in posted from another site', async () => {
    await createTestUser(context.db, 'owner');
    const response = await request(context.app)
      .post('/api/auth/login')
      .set('Origin', OTHER)
      .send({ email: 'owner@test.local', password: TEST_PASSWORD });
    expect(response.status).toBe(403);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('refreshes from the refresh cookie and the old one stops working', async () => {
    const { refresh } = await browserLogin();
    const first = await request(context.app).post('/api/auth/refresh').set('Origin', OURS).set('Cookie', `vd_refresh=${refresh}`).send({});
    expect(first.status).toBe(200);
    expect(first.body.data.token).toBeUndefined();
    const fresh = cookiesOf(first);
    expect(valueOf(fresh.vd_access)).not.toBe('');

    const again = await request(context.app).post('/api/auth/refresh').set('Origin', OURS).set('Cookie', `vd_refresh=${refresh}`).send({});
    expect(again.status).toBe(401);
    // A spent refresh cookie is cleared, so the page shows the sign-in.
    expect(cookiesOf(again).vd_refresh).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('swaps an old stored refresh token for cookies (the move from localStorage)', async () => {
    await createTestUser(context.db, 'owner');
    const old = await request(context.app).post('/api/auth/login').send({ email: 'owner@test.local', password: TEST_PASSWORD });
    const response = await request(context.app)
      .post('/api/auth/refresh')
      .set('Origin', OURS)
      .send({ refreshToken: old.body.data.refreshToken });
    expect(response.status).toBe(200);
    expect(cookiesOf(response).vd_access).toBeDefined();
    expect(response.body.data.token).toBeUndefined();
  });

  it('signs out only this device and clears the cookies', async () => {
    const one = await browserLogin();
    const two = await request(context.app)
      .post('/api/auth/login')
      .set('Origin', OURS)
      .send({ email: 'owner@test.local', password: TEST_PASSWORD });
    const twoRefresh = valueOf(cookiesOf(two).vd_refresh);

    const out = await request(context.app)
      .post('/api/auth/logout')
      .set('Origin', OURS)
      .set('Cookie', `vd_access=${one.access}; vd_refresh=${one.refresh}`)
      .send({});
    expect(out.status).toBe(200);
    expect(cookiesOf(out).vd_access).toMatch(/Expires=Thu, 01 Jan 1970/);

    const stillIn = await request(context.app).post('/api/auth/refresh').set('Origin', OURS).set('Cookie', `vd_refresh=${twoRefresh}`).send({});
    expect(stillIn.status).toBe(200);
  });

  it('does not let the portal cookie into the dashboard', async () => {
    const { access } = await browserLogin();
    const response = await request(context.app).get('/api/auth/me').set('Cookie', `portal_session=${access}`);
    expect(response.status).toBe(401);
  });
});
