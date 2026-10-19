import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestProduct, createTestUser, resetData, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers/testApp.js';

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
    expect(people.body.data).toEqual([{ id: admin.id, name: 'Test admin', role: 'admin', locked: false }]);
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
