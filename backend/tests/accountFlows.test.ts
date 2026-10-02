import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, resetData, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers/testApp.js';

let context: TestContext;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(() => resetData(context.db));
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);

async function linkSentTo(to: string): Promise<string | null> {
  const email = await context.db
    .selectFrom('email_outbox')
    .select('text')
    .where('to_address', '=', to)
    .orderBy('id', 'desc')
    .executeTakeFirst();
  return email ? /https?:\/\/\S+/.exec(email.text)![0] : null;
}
const tokenFrom = (link: string | null) => link!.split('/').at(-1)!;
const emailCount = async (to: string) =>
  (await context.db.selectFrom('email_outbox').select('id').where('to_address', '=', to).execute()).length;

async function login(email: string, password = TEST_PASSWORD) {
  return api().post('/api/auth/login').send({ email, password });
}

describe('forgot and reset password', () => {
  it('should answer the same for known and unknown emails, emailing only the known one', async () => {
    await createTestUser(context.db, 'employee', { email: 'ana@example.com' });

    const known = await api().post('/api/auth/forgot-password').send({ email: 'ana@example.com' });
    const unknown = await api().post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body.message).toBe(unknown.body.message);
    expect(await linkSentTo('ana@example.com')).toMatch(/^http:\/\/localhost:5173\/reset-password\//);
    expect(await emailCount('nobody@example.com')).toBe(0);
  });

  it('should set the new password once and log out every device', async () => {
    await createTestUser(context.db, 'employee', { email: 'ana@example.com' });
    const before = await login('ana@example.com');
    await api().post('/api/auth/forgot-password').send({ email: 'ana@example.com' });
    const token = tokenFrom(await linkSentTo('ana@example.com'));

    const reset = await api().post('/api/auth/reset-password').send({ token, password: 'brand-new-password' });
    const again = await api().post('/api/auth/reset-password').send({ token, password: 'another-password' });
    const oldSession = await api().post('/api/auth/refresh').send({ refreshToken: before.body.data.refreshToken });

    expect(reset.status).toBe(200);
    expect(again.status).toBe(410);
    expect(oldSession.status).toBe(401);
    expect((await login('ana@example.com', 'brand-new-password')).status).toBe(200);
  });

  it('should send at most one reset email a minute, so nobody can flood an inbox', async () => {
    await createTestUser(context.db, 'employee', { email: 'ana@example.com' });

    for (let attempt = 0; attempt < 3; attempt++) {
      await api().post('/api/auth/forgot-password').send({ email: 'ana@example.com' });
    }

    expect(await emailCount('ana@example.com')).toBe(1);
  });

  it('should refuse an expired reset link', async () => {
    await createTestUser(context.db, 'employee', { email: 'ana@example.com' });
    await api().post('/api/auth/forgot-password').send({ email: 'ana@example.com' });
    const token = tokenFrom(await linkSentTo('ana@example.com'));
    await context.db.updateTable('account_tokens').set({ expires_at: new Date(Date.now() - 1000) }).execute();

    expect((await api().post('/api/auth/reset-password').send({ token, password: 'brand-new-password' })).status).toBe(410);
  });
});

describe('email verification', () => {
  it('should keep unverified people out until they click the link', async () => {
    const user = await createTestUser(context.db, 'employee', { email: 'ana@example.com' });
    await context.db.updateTable('users').set({ email_verified_at: null }).where('id', '=', user.id).execute();

    const blocked = await login('ana@example.com');
    await api().post('/api/auth/resend-verification').send({ email: 'ana@example.com' });
    const link = await linkSentTo('ana@example.com');
    const verified = await api().post('/api/auth/verify-email').send({ token: tokenFrom(link) });

    expect(blocked.status).toBe(401);
    expect(blocked.body.message).toContain('Confirm your email');
    expect(link).toMatch(/\/verify-email\//);
    expect(verified.status).toBe(200);
    expect((await login('ana@example.com')).status).toBe(200);
  });
});

describe('changing your password', () => {
  it('should need the current password and log out the other devices only', async () => {
    await createTestUser(context.db, 'employee', { email: 'ana@example.com' });
    const phone = await login('ana@example.com');
    const laptop = await login('ana@example.com');

    const wrong = await api()
      .post('/api/me/password')
      .set(auth(laptop.body.data.token))
      .send({ currentPassword: 'not-it-at-all', newPassword: 'brand-new-password' });
    const changed = await api()
      .post('/api/me/password')
      .set(auth(laptop.body.data.token))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'brand-new-password' });
    const phoneRefresh = await api().post('/api/auth/refresh').send({ refreshToken: phone.body.data.refreshToken });
    const laptopRefresh = await api().post('/api/auth/refresh').send({ refreshToken: laptop.body.data.refreshToken });

    expect(wrong.status).toBe(400);
    expect(changed.status).toBe(200);
    expect(phoneRefresh.status).toBe(401);
    expect(laptopRefresh.status).toBe(200);
  });
});

describe('changing your email', () => {
  it('should switch only after the new address confirms, and tell the old address', async () => {
    await createTestUser(context.db, 'employee', { email: 'ana@example.com' });
    const session = await login('ana@example.com');

    const asked = await api()
      .post('/api/me/email')
      .set(auth(session.body.data.token))
      .send({ password: TEST_PASSWORD, newEmail: 'Ana.New@Example.com' });
    const stillOld = await login('ana@example.com');
    const confirmed = await api()
      .post('/api/auth/confirm-email-change')
      .send({ token: tokenFrom(await linkSentTo('ana.new@example.com')) });

    expect(asked.status).toBe(202);
    expect(stillOld.status).toBe(200);
    expect(confirmed.status).toBe(200);
    expect((await login('ana.new@example.com')).status).toBe(200);
    expect((await login('ana@example.com')).status).toBe(401);
    expect(await emailCount('ana@example.com')).toBe(1);
  });

  it('should refuse an address someone else uses, or a wrong password', async () => {
    await createTestUser(context.db, 'employee', { email: 'ana@example.com' });
    await createTestUser(context.db, 'admin', { email: 'bo@example.com' });
    const session = await login('ana@example.com');
    const ask = (body: Record<string, unknown>) =>
      api().post('/api/me/email').set(auth(session.body.data.token)).send(body);

    expect((await ask({ password: TEST_PASSWORD, newEmail: 'bo@example.com' })).status).toBe(409);
    expect((await ask({ password: 'not-it-at-all', newEmail: 'new@example.com' })).status).toBe(400);
  });
});
