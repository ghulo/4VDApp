import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { codeAt, currentStep, matchCode, SecretBox } from '../src/utils/totp.js';
import { createTestUser, loginAs, resetData, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers/testApp.js';

let context: TestContext;
const api = () => request(context.app);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  context = await setupTestApp();
});
// A fresh app per test, so the failed-sign-in limit (kept per app) starts at zero.
beforeEach(async () => {
  await resetData(context.db);
  context = { ...context, app: createApp(context.config, context.db, { container: context.container }) };
});
afterAll(() => context.db.destroy());

/** Turns two-step sign-in on for the owner; returns their token, the secret and the backup codes. */
async function ownerWithTwoStep() {
  const token = await loginAs(context, 'owner');
  const started = await api().post('/api/me/two-step/start').set(auth(token)).send({});
  expect(started.status).toBe(200);
  const secret = started.body.data.secret as string;
  expect(started.body.data.url).toMatch(/^otpauth:\/\/totp\/4VD%3Aowner%40test\.local\?secret=/);
  const confirmed = await api().post('/api/me/two-step/confirm').set(auth(token)).send({ code: codeAt(secret, currentStep()) });
  expect(confirmed.status).toBe(200);
  return { token, secret, backupCodes: confirmed.body.data.backupCodes as string[] };
}

const passwordStep = () => api().post('/api/auth/login').send({ email: 'owner@test.local', password: TEST_PASSWORD });

describe('the code maths (RFC 6238)', () => {
  it('matches the RFC test vector', () => {
    // RFC 6238, SHA1, secret "12345678901234567890", T = 59s → 94287082 (last 6 digits: 287082).
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(codeAt(secret, 1)).toBe('287082');
  });

  it('accepts a step either side but never one already used', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const now = 1_700_000_000_000;
    const step = currentStep(now);
    expect(matchCode(secret, codeAt(secret, step - 1), null, now)).toBe(step - 1);
    expect(matchCode(secret, codeAt(secret, step - 2), null, now)).toBeNull();
    expect(matchCode(secret, codeAt(secret, step), step, now)).toBeNull();
  });

  it('keeps secrets encrypted and opens ones sealed before TOTP_KEY was set', () => {
    const before = new SecretBox('jwt-secret-long-enough');
    const sealed = before.seal('SECRET');
    expect(sealed).not.toContain('SECRET');
    const after = new SecretBox('jwt-secret-long-enough', 'a'.repeat(32));
    expect(after.open(sealed)).toBe('SECRET');
    expect(after.open(after.seal('NEW'))).toBe('NEW');
  });
});

describe('two-step sign-in', () => {
  it('is off by default and the password alone signs in', async () => {
    const token = await loginAs(context, 'owner');
    const status = await api().get('/api/me/two-step').set(auth(token));
    expect(status.body.data).toEqual({ on: false, backupCodesLeft: 0 });
    expect((await api().get('/api/auth/me').set(auth(token))).body.data.twoStep).toBe(false);
  });

  it('turns on only with a right first code, and stores the secret encrypted', async () => {
    const token = await loginAs(context, 'owner');
    const started = await api().post('/api/me/two-step/start').set(auth(token)).send({});
    const wrong = await api().post('/api/me/two-step/confirm').set(auth(token)).send({ code: '000000' });
    expect(wrong.status).toBe(400);
    const row = await context.db.selectFrom('users').select(['totp_pending', 'totp_secret']).where('email', '=', 'owner@test.local').executeTakeFirstOrThrow();
    expect(row.totp_secret).toBeNull();
    expect(row.totp_pending).not.toContain(started.body.data.secret);
  });

  it('after the password, asks for the code and gives no session until then', async () => {
    const { secret } = await ownerWithTwoStep();
    const first = await passwordStep();
    expect(first.status).toBe(200);
    expect(first.body.data.twoStep).toBe(true);
    expect(first.body.data.token).toBeUndefined();
    expect(first.headers['set-cookie']).toBeUndefined();
    // The challenge is not a session.
    expect((await api().get('/api/auth/me').set(auth(first.body.data.challenge))).status).toBe(401);

    // A code from the next step: the one used to turn it on can't be used again.
    const code = codeAt(secret, currentStep() + 1);
    const second = await api().post('/api/auth/two-step').send({ challenge: first.body.data.challenge, code });
    expect(second.status).toBe(200);
    expect(second.body.data.token).toEqual(expect.any(String));
    expect(second.body.data.user.twoStep).toBe(true);
  });

  it('refuses a code used once already', async () => {
    const { secret } = await ownerWithTwoStep();
    const code = codeAt(secret, currentStep() + 1);
    const one = await passwordStep();
    expect((await api().post('/api/auth/two-step').send({ challenge: one.body.data.challenge, code })).status).toBe(200);
    const two = await passwordStep();
    expect((await api().post('/api/auth/two-step').send({ challenge: two.body.data.challenge, code })).status).toBe(401);
  });

  it('takes each backup code once', async () => {
    const { backupCodes } = await ownerWithTwoStep();
    expect(backupCodes).toHaveLength(10);
    const one = await passwordStep();
    const used = await api().post('/api/auth/two-step').send({ challenge: one.body.data.challenge, code: backupCodes[0]!.toUpperCase() });
    expect(used.status).toBe(200);
    const two = await passwordStep();
    expect((await api().post('/api/auth/two-step').send({ challenge: two.body.data.challenge, code: backupCodes[0] })).status).toBe(401);
    const status = await api().get('/api/me/two-step').set(auth(used.body.data.token));
    expect(status.body.data.backupCodesLeft).toBe(9);
  });

  it('locks after five wrong codes', async () => {
    const { secret } = await ownerWithTwoStep();
    const { body } = await passwordStep();
    for (let i = 0; i < 5; i++) {
      expect((await api().post('/api/auth/two-step').send({ challenge: body.data.challenge, code: '000000' })).status).toBe(401);
    }
    const locked = await api().post('/api/auth/two-step').send({ challenge: body.data.challenge, code: codeAt(secret, currentStep() + 1) });
    expect(locked.status).toBe(429);
  });

  it('starts the count again once the lock has run out', async () => {
    const { secret } = await ownerWithTwoStep();
    const { body } = await passwordStep();
    for (let i = 0; i < 5; i++) await api().post('/api/auth/two-step').send({ challenge: body.data.challenge, code: '000000' });
    // The 15 minutes pass.
    const realNow = Date.now;
    Date.now = () => realNow() + 16 * 60_000;
    try {
      const again = await passwordStep();
      // One wrong code after the lock is just one wrong code, not a new lock.
      expect((await api().post('/api/auth/two-step').send({ challenge: again.body.data.challenge, code: '000000' })).status).toBe(401);
      const right = await api().post('/api/auth/two-step').send({ challenge: again.body.data.challenge, code: codeAt(secret, currentStep()) });
      expect(right.status).toBe(200);
    } finally {
      Date.now = realNow;
    }
  });

  it('refuses a made-up or old challenge', async () => {
    await ownerWithTwoStep();
    const response = await api().post('/api/auth/two-step').send({ challenge: 'x'.repeat(40), code: '123456' });
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('TWO_STEP_EXPIRED');
  });

  it('turns off only with a right code', async () => {
    const { token, secret } = await ownerWithTwoStep();
    expect((await api().post('/api/me/two-step/off').set(auth(token)).send({ code: '000000' })).status).toBe(401);
    expect((await api().post('/api/me/two-step/off').set(auth(token)).send({ code: codeAt(secret, currentStep() + 1) })).status).toBe(200);
    expect((await passwordStep()).body.data.token).toEqual(expect.any(String));
  });

  it('lets the developer reset it for an owner, and logs who did', async () => {
    await ownerWithTwoStep();
    const owner = await context.db.selectFrom('users').select('id').where('email', '=', 'owner@test.local').executeTakeFirstOrThrow();
    const admin = await loginAs(context, 'admin');
    expect((await api().post(`/api/users/${owner.id}/two-step/reset`).set(auth(admin)).send({})).status).toBe(403);
    const developer = await loginAs(context, 'developer');
    expect((await api().post(`/api/users/${owner.id}/two-step/reset`).set(auth(developer)).send({})).status).toBe(200);
    expect((await passwordStep()).body.data.token).toEqual(expect.any(String));
    const logged = await context.db.selectFrom('activity_log').select('summary').where('action', '=', 'auth.two_step_reset').executeTakeFirstOrThrow();
    expect(logged.summary).toBe('Reset two-step sign-in for Test owner');
  });

  it('lets an admin reset it for an employee', async () => {
    const employee = await createTestUser(context.db, 'employee');
    await context.db.updateTable('users').set({ totp_secret: 'v1.x.y.z' }).where('id', '=', employee.id).execute();
    const admin = await loginAs(context, 'admin');
    expect((await api().post(`/api/users/${employee.id}/two-step/reset`).set(auth(admin)).send({})).status).toBe(200);
  });
});
