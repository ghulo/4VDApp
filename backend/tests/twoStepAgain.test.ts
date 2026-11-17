import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { codeAt, currentStep } from '../src/utils/totp.js';
import { SoftPasskey } from './helpers/softPasskey.js';
import { createTestUser, loginAs, resetData, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers/testApp.js';

/** "Make them set it up again": a manager's reset that also makes the person set two-step sign-in up afresh before any session. */

let context: TestContext;
const api = () => request(context.app);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  context = await setupTestApp();
});
// A fresh app per test, so the failed-sign-in limit and passkey challenges start empty.
beforeEach(async () => {
  await resetData(context.db);
  context = { ...context, app: createApp(context.config, context.db, { container: context.container }) };
});
afterAll(() => context.db.destroy());

const employeeLogin = () => api().post('/api/auth/login').send({ email: 'employee@test.local', password: TEST_PASSWORD });

/** An employee with two-step sign-in on and a session; an admin to reset it. */
async function employeeWithTwoStep() {
  const employee = await createTestUser(context.db, 'employee');
  const first = await employeeLogin();
  const token = first.body.data.token as string;
  const refreshToken = first.body.data.refreshToken as string;
  const started = await api().post('/api/me/two-step/start').set(auth(token)).send({});
  const secret = started.body.data.secret as string;
  expect((await api().post('/api/me/two-step/confirm').set(auth(token)).send({ code: codeAt(secret, currentStep()) })).status).toBe(200);
  const admin = await loginAs(context, 'admin');
  return { employee, token, refreshToken, secret, admin };
}

const again = (admin: string, userId: number) => api().post(`/api/users/${userId}/two-step/reset`).set(auth(admin)).send({ again: true });

describe('make them set two-step sign-in up again', () => {
  it('switches it off, marks them, signs them out everywhere, logs who asked, and shows nobody any codes', async () => {
    const { employee, token, refreshToken, admin } = await employeeWithTwoStep();
    const response = await again(admin, employee.id);
    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();

    const row = await context.db.selectFrom('users').selectAll().where('id', '=', employee.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ two_step_required: true, totp_secret: null, totp_pending: null, totp_recovery: [] });
    const logged = await context.db.selectFrom('activity_log').select(['summary', 'user_id']).where('action', '=', 'auth.two_step_again').executeTakeFirstOrThrow();
    expect(logged.summary).toBe('Switched off two-step sign-in for Test employee and asked them to set it up again');
    expect(logged.user_id).not.toBe(employee.id);

    // An old session (access tokens last days) and its refresh token stop working.
    const me = await api().get('/api/auth/me').set(auth(token));
    expect(me.status).toBe(401);
    expect(me.body.error).toBe('TWO_STEP_SETUP_NEEDED');
    expect((await api().post('/api/auth/refresh').send({ refreshToken })).status).toBe(401);

    // People lists say it's owed.
    const people = await api().get('/api/users').set(auth(admin));
    expect(people.body.data.find((person: { id: number }) => person.id === employee.id)).toMatchObject({ twoStep: false, twoStepRequired: true });
  });

  it('after the password, leads to the setup with no session; the first right code turns it on and only then signs in', async () => {
    const { employee, admin } = await employeeWithTwoStep();
    await again(admin, employee.id);

    const first = await employeeLogin();
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ twoStepSetup: true, setupChallenge: expect.any(String) });
    expect(first.headers['set-cookie']).toBeUndefined();
    const setupChallenge = first.body.data.setupChallenge as string;
    // The setup challenge is not a session.
    expect((await api().get('/api/auth/me').set(auth(setupChallenge))).status).toBe(401);

    const started = await api().post('/api/auth/two-step/setup/start').send({ setupChallenge });
    expect(started.status).toBe(200);
    expect(started.body.data.url).toMatch(/^otpauth:\/\/totp\/4VD%3Aemployee%40test\.local\?secret=/);
    const secret = started.body.data.secret as string;

    expect((await api().post('/api/auth/two-step/setup/confirm').send({ setupChallenge, code: '000000' })).status).toBe(400);
    const done = await api().post('/api/auth/two-step/setup/confirm').send({ setupChallenge, code: codeAt(secret, currentStep()) });
    expect(done.status).toBe(200);
    expect(done.body.data.backupCodes).toHaveLength(10);
    expect(done.body.data.token).toEqual(expect.any(String));
    expect(done.body.data.user).toMatchObject({ id: employee.id, twoStep: true, twoStepRequired: false });
    expect((await api().get('/api/auth/me').set(auth(done.body.data.token))).status).toBe(200);

    const row = await context.db.selectFrom('users').select(['two_step_required', 'totp_recovery']).where('id', '=', employee.id).executeTakeFirstOrThrow();
    expect(row.two_step_required).toBe(false);
    // Kept only as hashes.
    expect(row.totp_recovery).toHaveLength(10);
    expect(row.totp_recovery).not.toContain(done.body.data.backupCodes[0]);

    // The same setup challenge can't be used again, and the next sign-in asks for the code as usual.
    expect((await api().post('/api/auth/two-step/setup/start').send({ setupChallenge })).status).toBe(401);
    expect((await employeeLogin()).body.data.twoStep).toBe(true);
  });

  it("can't be skipped: an older code-step challenge, the wrong kind of challenge, a passkey or a Counter PIN give no session", async () => {
    const { employee, secret, admin } = await employeeWithTwoStep();
    const before = await employeeLogin();
    const challenge = before.body.data.challenge as string;
    await again(admin, employee.id);

    // A code step started before the reset.
    const late = await api().post('/api/auth/two-step').send({ challenge, code: codeAt(secret, currentStep() + 1) });
    expect(late.status).toBe(403);
    expect(late.body.error).toBe('TWO_STEP_SETUP_NEEDED');
    expect(late.body.data?.token).toBeUndefined();

    // The two kinds of challenge don't stand in for each other.
    const { setupChallenge } = (await employeeLogin()).body.data as { setupChallenge: string };
    expect((await api().post('/api/auth/two-step/setup/start').send({ setupChallenge: challenge })).body.error).toBe('TWO_STEP_EXPIRED');
    expect((await api().post('/api/auth/two-step').send({ challenge: setupChallenge, code: '123456' })).body.error).toBe('TWO_STEP_EXPIRED');
  });

  it('a passkey sign-in also lands on the setup', async () => {
    const employee = await createTestUser(context.db, 'employee');
    const token = (await employeeLogin()).body.data.token as string;
    const url = new URL(context.config.dashboardUrl);
    const key = new SoftPasskey(url.hostname, context.config.dashboardUrl);
    const options = await api().post('/api/me/passkeys/options').set(auth(token)).send({ password: TEST_PASSWORD });
    expect((await api().post('/api/me/passkeys').set(auth(token)).send({ response: key.create(options.body.data) })).status).toBe(200);

    const admin = await loginAs(context, 'admin');
    expect((await again(admin, employee.id)).status).toBe(200);

    const signInOptions = await api().post('/api/auth/passkey/options').send({});
    const signedIn = await api().post('/api/auth/passkey').send({ response: key.get(signInOptions.body.data) });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.data).toEqual({ twoStepSetup: true, setupChallenge: expect.any(String) });
    expect(signedIn.headers['set-cookie']).toBeUndefined();
  });

  it('a Counter PIN takeover is refused, and the person at the Counter stays signed in', async () => {
    const cashier = await createTestUser(context.db, 'employee');
    const cashierLogin = await employeeLogin();
    const admin = await createTestUser(context.db, 'admin');
    const adminToken = (await api().post('/api/auth/login').send({ email: admin.email, password: TEST_PASSWORD })).body.data.token as string;
    expect((await api().put('/api/me/pin').set(auth(adminToken)).send({ password: TEST_PASSWORD, pin: '4321' })).status).toBe(200);
    await context.db.updateTable('users').set({ two_step_required: true }).where('id', '=', admin.id).execute();

    const switched = await api().post('/api/counter/switch').set(auth(cashierLogin.body.data.token)).send({ userId: admin.id, pin: '4321' });
    expect(switched.status).toBe(403);
    expect(switched.body.error).toBe('TWO_STEP_SETUP_NEEDED');
    expect((await api().post('/api/auth/refresh').send({ refreshToken: cashierLogin.body.data.refreshToken })).status).toBe(200);
    expect(cashier.id).not.toBe(admin.id);
  });

  it('plain "Switch off" clears the mark again', async () => {
    const { employee, admin } = await employeeWithTwoStep();
    await again(admin, employee.id);
    expect((await api().post(`/api/users/${employee.id}/two-step/reset`).set(auth(admin)).send({})).status).toBe(200);
    expect((await employeeLogin()).body.data.token).toEqual(expect.any(String));
  });

  it('follows the same rule as the plain reset: an admin cannot do it to an owner', async () => {
    const owner = await createTestUser(context.db, 'owner');
    const admin = await loginAs(context, 'admin');
    expect((await again(admin, owner.id)).status).toBe(403);
    const employee = await loginAs(context, 'employee', { email: 'e2@test.local' });
    expect((await again(employee, owner.id)).status).toBe(403);
    const row = await context.db.selectFrom('users').select('two_step_required').where('id', '=', owner.id).executeTakeFirstOrThrow();
    expect(row.two_step_required).toBe(false);
  });
});
