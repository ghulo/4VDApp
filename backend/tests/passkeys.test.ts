import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { codeAt, currentStep } from '../src/utils/totp.js';
import { SoftPasskey } from './helpers/softPasskey.js';
import { createTestUser, loginAs, resetData, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers/testApp.js';

let context: TestContext;
const api = () => request(context.app);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const origin = () => context.config.dashboardUrl;
const rpId = () => new URL(context.config.dashboardUrl).hostname;
const newKey = (options?: ConstructorParameters<typeof SoftPasskey>[2]) => new SoftPasskey(rpId(), origin(), options);

beforeAll(async () => {
  context = await setupTestApp();
});
// A fresh app per test: the failed-sign-in limit and the open challenges start empty.
beforeEach(async () => {
  await resetData(context.db);
  context = { ...context, app: createApp(context.config, context.db, { container: context.container }) };
});
afterAll(() => context.db.destroy());

/** Adds a passkey for whoever owns the token (re-confirmed with the test password). */
async function addPasskey(token: string, key = newKey()) {
  const options = await api().post('/api/me/passkeys/options').set(auth(token)).send({ password: TEST_PASSWORD });
  expect(options.status).toBe(200);
  const added = await api().post('/api/me/passkeys').set(auth(token)).send({ response: key.create(options.body.data) });
  expect(added.status).toBe(200);
  return { key, passkey: added.body.data as { id: number; name: string; synced: boolean } };
}

async function signInWith(key: SoftPasskey, overrides?: Parameters<SoftPasskey['get']>[1]) {
  const options = await api().post('/api/auth/passkey/options').send({});
  expect(options.status).toBe(200);
  return api().post('/api/auth/passkey').send({ response: key.get(options.body.data, overrides) });
}

describe('adding passkeys', () => {
  it('asks for the password first, then saves the passkey, logs it and emails the person', async () => {
    const token = await loginAs(context, 'owner');
    const listed = await api().get('/api/me/passkeys').set(auth(token));
    expect(listed.body.data).toEqual({ passkeys: [], confirmWith: 'password' });

    const wrong = await api().post('/api/me/passkeys/options').set(auth(token)).send({ password: 'not-it' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe('WRONG_PASSWORD');

    const { passkey } = await addPasskey(token, newKey({ synced: true }));
    expect(passkey).toMatchObject({ synced: true, lastUsedAt: null });

    const after = await api().get('/api/me/passkeys').set(auth(token));
    expect(after.body.data.passkeys).toHaveLength(1);
    const log = await context.db.selectFrom('activity_log').select('action').where('action', '=', 'auth.passkey_added').execute();
    expect(log).toHaveLength(1);
    const mail = await context.db.selectFrom('email_outbox').select(['to_address', 'subject']).execute();
    expect(mail).toEqual([{ to_address: 'owner@test.local', subject: 'A passkey was added to your 4VD account' }]);
  });

  it('refuses a passkey made without the fingerprint, face or PIN check', async () => {
    const token = await loginAs(context, 'owner');
    const options = await api().post('/api/me/passkeys/options').set(auth(token)).send({ password: TEST_PASSWORD });
    const added = await api().post('/api/me/passkeys').set(auth(token)).send({ response: newKey({ userVerified: false }).create(options.body.data) });
    expect(added.status).toBe(400);
    expect(added.body.error).toBe('PASSKEY_NOT_SAVED');
  });

  it('asks for the two-step code instead of the password when two-step sign-in is on', async () => {
    const token = await loginAs(context, 'owner');
    const started = await api().post('/api/me/two-step/start').set(auth(token)).send({});
    const secret = started.body.data.secret as string;
    await api().post('/api/me/two-step/confirm').set(auth(token)).send({ code: codeAt(secret, currentStep()) });

    const listed = await api().get('/api/me/passkeys').set(auth(token));
    expect(listed.body.data.confirmWith).toBe('code');
    const byPassword = await api().post('/api/me/passkeys/options').set(auth(token)).send({ password: TEST_PASSWORD });
    expect(byPassword.status).toBe(400);
    // The code already used to confirm can't be used again: take the next step's.
    const byCode = await api().post('/api/me/passkeys/options').set(auth(token)).send({ code: codeAt(secret, currentStep() + 1) });
    expect(byCode.status).toBe(200);
  });
});

describe('signing in with a passkey', () => {
  it('signs in with no email or password and logs how', async () => {
    const token = await loginAs(context, 'owner');
    const { key } = await addPasskey(token);
    const signedIn = await signInWith(key);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.data.user.email).toBe('owner@test.local');
    expect(signedIn.body.data.token).toEqual(expect.any(String));

    const me = await api().get('/api/auth/me').set(auth(signedIn.body.data.token));
    expect(me.status).toBe(200);
    const row = await context.db.selectFrom('passkeys').select('last_used_at').executeTakeFirstOrThrow();
    expect(row.last_used_at).not.toBeNull();
    const log = await context.db.selectFrom('activity_log').select(['summary_say as details']).where('action', '=', 'auth.logged_in').orderBy('id', 'desc').executeTakeFirstOrThrow();
    expect(JSON.stringify(log.details)).toContain('passkey');
  });

  it('gives a browser the same httpOnly cookies as the password, and no tokens', async () => {
    const token = await loginAs(context, 'owner');
    const { key } = await addPasskey(token);
    const options = await api().post('/api/auth/passkey/options').set('Origin', origin()).send({});
    const signedIn = await api().post('/api/auth/passkey').set('Origin', origin()).send({ response: key.get(options.body.data) });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.data.token).toBeUndefined();
    const cookies = String(signedIn.headers['set-cookie']);
    expect(cookies).toMatch(/vd_access=.*HttpOnly/);
    expect(cookies).toMatch(/vd_refresh=.*HttpOnly/);
  });

  it('uses each challenge once', async () => {
    const token = await loginAs(context, 'owner');
    const { key } = await addPasskey(token);
    const options = await api().post('/api/auth/passkey/options').send({});
    const first = await api().post('/api/auth/passkey').send({ response: key.get(options.body.data) });
    expect(first.status).toBe(200);
    const again = await api().post('/api/auth/passkey').send({ response: key.get(options.body.data) });
    expect(again.status).toBe(401);
    expect(again.body.error).toBe('PASSKEY_FAILED');
  });

  it('refuses an answer signed for another site', async () => {
    const token = await loginAs(context, 'owner');
    const { key } = await addPasskey(token);
    const signedIn = await signInWith(key, { origin: 'https://evil.example' });
    expect(signedIn.status).toBe(401);
  });

  it('refuses a passkey nobody saved, and a person who was switched off', async () => {
    const unknown = await signInWith(newKey());
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toBe('PASSKEY_UNKNOWN');

    const token = await loginAs(context, 'employee');
    const { key } = await addPasskey(token);
    await context.db.updateTable('users').set({ is_active: false }).where('email', '=', 'employee@test.local').execute();
    const off = await signInWith(key);
    expect(off.status).toBe(401);
  });

  it('refuses a passkey whose use count went backwards (copied) and logs it', async () => {
    const token = await loginAs(context, 'owner');
    const { key } = await addPasskey(token, newKey({ counter: 5 }));
    expect((await signInWith(key)).status).toBe(200);
    // A copy that still has the old count.
    key.counter = 3;
    const copied = await signInWith(key, { bumpCounter: false });
    expect(copied.status).toBe(401);
    expect(copied.body.error).toBe('PASSKEY_REFUSED');
    const log = await context.db.selectFrom('activity_log').select('action').where('action', '=', 'auth.passkey_refused').execute();
    expect(log).toHaveLength(1);
  });

  it('accepts synced passkeys, whose count always stays 0', async () => {
    const token = await loginAs(context, 'owner');
    const { key } = await addPasskey(token, newKey({ synced: true }));
    expect((await signInWith(key)).status).toBe(200);
    expect((await signInWith(key)).status).toBe(200);
  });
});

describe('a passkey instead of the two-step code', () => {
  it('finishes a password sign-in with a passkey, and offers nothing to someone without one', async () => {
    const token = await loginAs(context, 'owner');
    const { key } = await addPasskey(token);
    const started = await api().post('/api/me/two-step/start').set(auth(token)).send({});
    await api().post('/api/me/two-step/confirm').set(auth(token)).send({ code: codeAt(started.body.data.secret, currentStep()) });

    const password = await api().post('/api/auth/login').send({ email: 'owner@test.local', password: TEST_PASSWORD });
    const challenge = password.body.data.challenge as string;
    const options = await api().post('/api/auth/two-step/passkey/options').send({ challenge });
    expect(options.body.data.allowCredentials).toEqual([expect.objectContaining({ id: key.id })]);
    const finished = await api().post('/api/auth/two-step/passkey').send({ challenge, response: key.get(options.body.data) });
    expect(finished.status).toBe(200);
    expect(finished.body.data.user.email).toBe('owner@test.local');

    // Another person's passkey can't finish this person's sign-in.
    const other = await loginAs(context, 'employee');
    const { key: otherKey } = await addPasskey(other);
    const again = await api().post('/api/auth/login').send({ email: 'owner@test.local', password: TEST_PASSWORD });
    const options2 = await api().post('/api/auth/two-step/passkey/options').send({ challenge: again.body.data.challenge });
    const wrongPerson = await api().post('/api/auth/two-step/passkey').send({ challenge: again.body.data.challenge, response: otherKey.get(options2.body.data) });
    expect(wrongPerson.status).toBe(401);
  });

  it('returns no prompt for someone with no passkeys', async () => {
    const token = await loginAs(context, 'owner');
    const started = await api().post('/api/me/two-step/start').set(auth(token)).send({});
    await api().post('/api/me/two-step/confirm').set(auth(token)).send({ code: codeAt(started.body.data.secret, currentStep()) });
    const password = await api().post('/api/auth/login').send({ email: 'owner@test.local', password: TEST_PASSWORD });
    const options = await api().post('/api/auth/two-step/passkey/options').send({ challenge: password.body.data.challenge });
    expect(options.status).toBe(200);
    expect(options.body.data).toBeNull();
  });
});

describe('managing passkeys', () => {
  it('renames and removes only the person’s own passkeys', async () => {
    const owner = await loginAs(context, 'owner');
    const { passkey, key } = await addPasskey(owner);
    const employee = await loginAs(context, 'employee');
    expect((await api().delete(`/api/me/passkeys/${passkey.id}`).set(auth(employee))).status).toBe(404);

    const renamed = await api().patch(`/api/me/passkeys/${passkey.id}`).set(auth(owner)).send({ name: 'Office laptop' });
    expect(renamed.body.data.name).toBe('Office laptop');
    expect((await api().delete(`/api/me/passkeys/${passkey.id}`).set(auth(owner))).status).toBe(200);
    expect((await signInWith(key)).body.error).toBe('PASSKEY_UNKNOWN');
  });

  it('lets an admin remove an employee’s passkeys and logs it; the developer only for an owner', async () => {
    const employeeToken = await loginAs(context, 'employee');
    await addPasskey(employeeToken);
    const employee = await context.db.selectFrom('users').select('id').where('email', '=', 'employee@test.local').executeTakeFirstOrThrow();
    const owner = await createTestUser(context.db, 'owner');
    expect((await api().post(`/api/users/${owner.id}/passkeys/reset`).set(auth(employeeToken))).status).toBe(403);

    const admin = await loginAs(context, 'admin');
    expect((await api().post(`/api/users/${owner.id}/passkeys/reset`).set(auth(admin))).status).toBe(403);
    const reset = await api().post(`/api/users/${employee.id}/passkeys/reset`).set(auth(admin));
    expect(reset.status).toBe(200);
    expect(reset.body.data).toEqual({ removed: 1 });
    expect(await context.db.selectFrom('passkeys').select('id').execute()).toHaveLength(0);
    const logged = await context.db.selectFrom('activity_log').select('summary').where('action', '=', 'auth.passkeys_reset').executeTakeFirstOrThrow();
    expect(logged.summary).toBe('Removed Test employee’s passkeys (1)');
  });
});
