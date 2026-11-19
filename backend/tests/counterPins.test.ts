import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runAsBusiness } from '../src/database/businessContext.js';
import { createBusiness } from '../src/database/newBusiness.js';
import { createLiveLikeDatabase, createTestProduct, createTestUser, loginAs, resetData, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers/testApp.js';

let context: TestContext;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(() => resetData(context.db));
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signIn(role: 'admin' | 'employee' | 'owner') {
  const user = await createTestUser(context.db, role);
  const response = await request(context.app).post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
  return { id: user.id, token: response.body.data.token as string, refreshToken: response.body.data.refreshToken as string };
}

const setPin = (token: string, pin: string | null, password = TEST_PASSWORD) =>
  request(context.app).put('/api/me/pin').set(auth(token)).send({ password, pin });

describe('Counter PINs', () => {
  it('should save a PIN only after the password, and never send it back', async () => {
    const admin = await signIn('admin');
    expect((await setPin(admin.token, '1234', 'wrong-password')).status).toBe(422);
    expect((await setPin(admin.token, '12a4')).status).toBe(400);

    const saved = await setPin(admin.token, '1234');
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ hasPassword: true, hasPin: true });
    expect(JSON.stringify(saved.body)).not.toContain('pin_hash');
    expect((await request(context.app).get('/api/me/security').set(auth(admin.token))).body.data.hasPin).toBe(true);

    expect((await setPin(admin.token, null)).body.data.hasPin).toBe(false);
    const actions = await context.db.selectFrom('activity_log').select('action').where('action', 'like', 'pin.%').orderBy('id').execute();
    expect(actions.map((row) => row.action)).toEqual(['pin.set', 'pin.removed']);
  });

  it('should hand the Counter to another person on the same PC and end the first session', async () => {
    const employee = await signIn('employee');
    const admin = await signIn('admin');
    await setPin(admin.token, '4321');

    const people = await request(context.app).get('/api/counter/pin-people').set(auth(employee.token));
    expect(people.body.data).toEqual([{ id: admin.id, name: 'Test admin', role: 'admin', locked: false, lockedToday: false }]);
    expect((await request(context.app).get('/api/counter/pin-people').set(auth(admin.token))).body.data).toEqual([]);

    const switched = await request(context.app).post('/api/counter/switch').set(auth(employee.token)).send({ userId: admin.id, pin: '4321' });
    expect(switched.status).toBe(200);
    expect(switched.body.data.user.id).toBe(admin.id);

    // The employee's session on this PC is over; the new one keeps the PC.
    expect((await request(context.app).post('/api/auth/refresh').send({ refreshToken: employee.refreshToken })).status).toBe(401);
    const devices = await context.db.selectFrom('refresh_tokens').select(['user_id', 'device_id']).orderBy('id').execute();
    const employeeDevice = devices.find((row) => row.user_id === employee.id)!.device_id;
    expect(devices.at(-1)).toEqual({ user_id: admin.id, device_id: employeeDevice });
    const event = await context.db.selectFrom('counter_events').select(['kind', 'user_id', 'reason']).executeTakeFirstOrThrow();
    expect(event).toEqual({ kind: 'person_switched', user_id: admin.id, reason: 'Test employee' });
  });

  it('should lock a person after 5 wrong PINs until they sign in with the password', async () => {
    const employee = await signIn('employee');
    const admin = await signIn('admin');
    await setPin(admin.token, '4321');
    const tryPin = (pin: string) => request(context.app).post('/api/counter/switch').set(auth(employee.token)).send({ userId: admin.id, pin });

    for (let attempt = 1; attempt <= 4; attempt++) {
      const wrong = await tryPin('0000');
      expect(wrong.status).toBe(422);
      expect(wrong.body.message).toContain(`${5 - attempt} ${5 - attempt === 1 ? 'try' : 'tries'} left`);
    }
    expect((await tryPin('0000')).status).toBe(429);
    // Locked: even the right PIN is refused now.
    expect((await tryPin('4321')).status).toBe(429);
    expect((await request(context.app).get('/api/counter/pin-people').set(auth(employee.token))).body.data[0].locked).toBe(true);
    expect(await context.db.selectFrom('activity_log').select('id').where('action', '=', 'pin.locked').execute()).toHaveLength(1);

    await request(context.app).post('/api/auth/login').send({ email: 'admin@test.local', password: TEST_PASSWORD });
    expect((await tryPin('4321')).status).toBe(200);
  });

  it('should let an owner allow a bigger rabat once, for the person who asked', async () => {
    const employee = await signIn('employee');
    const admin = await signIn('admin');
    await setPin(admin.token, '4321');
    const product = await createTestProduct(context, admin.token, { name: 'Vase', price: 20, stock: 10 });
    const basket = (approval?: string) =>
      request(context.app)
        .post('/api/sales/basket')
        .set(auth(employee.token))
        .send({ items: [{ productId: product, quantity: 1, discountPercent: 50 }], ...(approval && { rabatApproval: approval }) });

    expect((await basket()).status).toBe(403);
    const wrong = await request(context.app).post('/api/counter/rabat-approvals').set(auth(employee.token)).send({ userId: admin.id, pin: '1111', percent: 50, basketId: 'b1' });
    expect(wrong.status).toBe(422);
    const allowed = await request(context.app).post('/api/counter/rabat-approvals').set(auth(employee.token)).send({ userId: admin.id, pin: '4321', percent: 50, basketId: 'b1' });
    expect(allowed.status).toBe(201);
    expect(allowed.body.data).toMatchObject({ by: 'Test admin', percent: 50 });

    const sold = await basket(allowed.body.data.token);
    expect(sold.status).toBe(201);
    expect(sold.body.data.total).toBe(10);
    // Used once: the same yes doesn't work a second time.
    expect((await basket(allowed.body.data.token)).status).toBe(403);
    const event = await context.db.selectFrom('counter_events').select(['kind', 'user_id', 'reason']).executeTakeFirstOrThrow();
    expect(event).toEqual({ kind: 'rabat_allowed', user_id: employee.id, reason: 'Test admin · 50%' });
  });

  it('should not let an employee approve a rabat', async () => {
    const owner = await signIn('owner');
    const employee = await signIn('employee');
    await setPin(employee.token, '2468');
    const asked = await request(context.app).post('/api/counter/rabat-approvals').set(auth(owner.token)).send({ userId: employee.id, pin: '2468', percent: 30, basketId: 'b1' });
    expect(asked.status).toBe(404);
    expect((await request(context.app).get('/api/counter/pin-people').query({ approvers: 'true' }).set(auth(owner.token))).body.data).toEqual([]);
  });
});

describe('the daily cap on wrong Counter PINs', () => {
  const tryPin = (token: string, userId: number, pin: string) =>
    request(context.app).post('/api/counter/rabat-approvals').set(auth(token)).send({ userId, pin, percent: 10, basketId: 'b1' });
  const lockedOf = async (token: string, userId: number) =>
    ((await request(context.app).get('/api/counter/pin-people').query({ approvers: 'true' }).set(auth(token))).body.data as Array<{ id: number; locked: boolean; lockedToday: boolean }>).find(
      (person) => person.id === userId,
    );
  const wrongTries = async (userId: number) =>
    Number(
      (await context.db.selectFrom('pin_attempts').select((eb) => eb.fn.countAll<string>().as('n')).where('user_id', '=', userId).where('ok', '=', false).executeTakeFirstOrThrow()).n,
    );
  /** Wrong PINs typed straight into the table, stamped `hoursAgo` back (the database stamps real ones itself). */
  const pastWrongTries = async (userId: number, count: number, hoursAgo: number, businessId?: number) => {
    const at = new Date(Date.now() - hoursAgo * 3_600_000);
    await context.db
      .insertInto('pin_attempts')
      .values(
        Array.from({ length: count }, () => ({
          user_id: userId,
          device_id: '00000000-0000-4000-8000-000000000001',
          purpose: 'rabat' as const,
          ok: false,
          at,
          ...(businessId !== undefined && { business_id: businessId }),
        })),
      )
      .execute();
  };
  const todo = async (token: string) =>
    ((await request(context.app).get('/api/attention').set(auth(token))).body.data.todo as Array<{ kind: string; to: string }>).filter((item) => item.kind === 'pin_locked');

  it('should lock a PIN after 10 wrong in a day, even with right ones between, and leave every other way in working', async () => {
    const employee = await signIn('employee');
    const admin = await signIn('admin');
    await setPin(admin.token, '4321');

    // A right PIN ends the 15-minute count but not the daily one.
    for (let round = 0; round < 2; round++) {
      for (let attempt = 0; attempt < 4; attempt++) expect((await tryPin(employee.token, admin.id, '0000')).status).toBe(422);
      expect((await tryPin(employee.token, admin.id, '4321')).status).toBe(201);
    }
    const ninth = await tryPin(employee.token, admin.id, '0000');
    expect(ninth.status).toBe(422);
    expect(ninth.body.message).toContain('1 try left today');
    const tenth = await tryPin(employee.token, admin.id, '0000');
    expect(tenth.status).toBe(429);
    expect(tenth.body.error).toBe('PIN_LOCKED_DAY');

    // Even the right PIN, and even after a password sign-in (which ends only the 15-minute lock).
    expect((await tryPin(employee.token, admin.id, '4321')).body.error).toBe('PIN_LOCKED_DAY');
    expect((await request(context.app).post('/api/auth/login').send({ email: 'admin@test.local', password: TEST_PASSWORD })).status).toBe(200);
    expect((await tryPin(employee.token, admin.id, '4321')).body.error).toBe('PIN_LOCKED_DAY');
    expect(await lockedOf(employee.token, admin.id)).toMatchObject({ locked: true, lockedToday: true });
    expect(await wrongTries(admin.id)).toBe(10);
    expect(await context.db.selectFrom('activity_log').select('id').where('action', '=', 'pin.day_locked').execute()).toHaveLength(1);

    // The person at the Counter stays signed in, and someone else's PIN still works on this PC.
    expect((await request(context.app).get('/api/counter/settings').set(auth(employee.token))).status).toBe(200);
    const owner = await signIn('owner');
    await setPin(owner.token, '2468');
    expect((await tryPin(employee.token, owner.id, '2468')).status).toBe(201);
  });

  it('should tell whoever manages People, and let them unlock it', async () => {
    const employee = await signIn('employee');
    const admin = await signIn('admin');
    await setPin(admin.token, '4321');
    const mainAdmin = await loginAs(context, 'main_admin');
    // Five from an hour ago and five now: both locks are on.
    await pastWrongTries(admin.id, 5, 1);
    for (let attempt = 0; attempt < 5; attempt++) await tryPin(employee.token, admin.id, '0000');

    expect(await todo(mainAdmin)).toEqual([expect.objectContaining({ kind: 'pin_locked', to: `/people/${admin.id}` })]);
    expect(await todo(employee.token)).toEqual([]);
    const listed = (await request(context.app).get('/api/users?limit=100').set(auth(mainAdmin))).body.data as Array<{ id: number; pinLocked: boolean }>;
    expect(listed.find((person) => person.id === admin.id)?.pinLocked).toBe(true);
    expect(listed.find((person) => person.id === employee.id)?.pinLocked).toBe(false);

    // Only managers unlock it.
    expect((await request(context.app).post(`/api/users/${admin.id}/pin/unlock`).set(auth(employee.token))).status).toBe(403);
    expect((await request(context.app).post(`/api/users/${admin.id}/pin/unlock`).set(auth(mainAdmin))).status).toBe(200);

    // Unlocking ends the 15-minute lock too.
    expect(await lockedOf(employee.token, admin.id)).toMatchObject({ locked: false, lockedToday: false });
    expect(await todo(mainAdmin)).toEqual([]);
    expect((await tryPin(employee.token, admin.id, '4321')).status).toBe(201);
    const logged = await context.db.selectFrom('activity_log').select(['entity_id', 'summary']).where('action', '=', 'pin.unlocked').executeTakeFirstOrThrow();
    expect(logged).toEqual({ entity_id: admin.id, summary: 'Unlocked the Counter PIN for Test admin' });
  });

  it('should let a manager unlock their own PIN, but not one of a higher role', async () => {
    const admin = await signIn('admin');
    await setPin(admin.token, '4321');
    const mainAdmin = await createTestUser(context.db, 'main_admin');
    const { pin_hash } = await context.db.selectFrom('users').select('pin_hash').where('id', '=', admin.id).executeTakeFirstOrThrow();
    await context.db.updateTable('users').set({ pin_hash }).where('id', '=', mainAdmin.id).execute();
    await pastWrongTries(admin.id, 10, 1);
    await pastWrongTries(mainAdmin.id, 10, 1);

    expect((await request(context.app).post(`/api/users/${mainAdmin.id}/pin/unlock`).set(auth(admin.token))).status).toBe(403);
    expect((await request(context.app).post(`/api/users/${admin.id}/pin/unlock`).set(auth(admin.token))).status).toBe(200);
  });

  it('should forget wrong PINs a day old, and count only the business they were typed in', async () => {
    const employee = await signIn('employee');
    const admin = await signIn('admin');
    await setPin(admin.token, '4321');
    await pastWrongTries(admin.id, 10, 25);
    const live = createLiveLikeDatabase();
    try {
      const otherId = await createBusiness(live, 'PIN Two', async (_trx, businessId) => businessId);
      await runAsBusiness(otherId, () => pastWrongTries(admin.id, 10, 1, otherId));
    } finally {
      await live.destroy();
    }

    expect(await lockedOf(employee.token, admin.id)).toMatchObject({ locked: false, lockedToday: false });
    expect((await tryPin(employee.token, admin.id, '4321')).status).toBe(201);
  });

  it('should take parallel guesses one at a time, so none slip past the lock', async () => {
    const employee = await signIn('employee');
    const admin = await signIn('admin');
    await setPin(admin.token, '4321');

    const answers = await Promise.all(Array.from({ length: 12 }, () => tryPin(employee.token, admin.id, '0000')));
    expect(answers.filter((answer) => answer.status === 422)).toHaveLength(4);
    expect(answers.filter((answer) => answer.status === 429)).toHaveLength(8);
    expect(await wrongTries(admin.id)).toBe(5);
  });
});
