import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { describeDevice } from '../src/services/SessionService.js';
import { createTestUser, resetData, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers/testApp.js';

let context: TestContext;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(() => resetData(context.db));
afterAll(() => context.db.destroy());

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const login = (userAgent: string) =>
  request(context.app).post('/api/auth/login').set('User-Agent', userAgent).send({ email: 'ana@example.com', password: TEST_PASSWORD });

describe('devices', () => {
  beforeEach(() => createTestUser(context.db, 'employee', { email: 'ana@example.com' }));

  it('should list each device once, newest first, marking this one', async () => {
    const laptop = await login(CHROME_WINDOWS);
    const phone = await login(SAFARI_IPHONE);
    // A refresh continues the same device; it must not show up twice.
    await request(context.app).post('/api/auth/refresh').set('User-Agent', SAFARI_IPHONE).send({ refreshToken: phone.body.data.refreshToken });

    const list = await request(context.app).get('/api/me/sessions').set(auth(laptop.body.data.token));

    expect(list.body.data).toHaveLength(2);
    expect(list.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ device: 'Chrome on Windows', current: true }),
        expect.objectContaining({ device: 'Safari on iPhone', current: false }),
      ]),
    );
  });

  it('should log out one device', async () => {
    const laptop = await login(CHROME_WINDOWS);
    const phone = await login(SAFARI_IPHONE);
    const list = await request(context.app).get('/api/me/sessions').set(auth(laptop.body.data.token));
    const phoneSession = list.body.data.find((session: { current: boolean }) => !session.current);

    const ended = await request(context.app).delete(`/api/me/sessions/${phoneSession.id}`).set(auth(laptop.body.data.token));
    const phoneRefresh = await request(context.app).post('/api/auth/refresh').send({ refreshToken: phone.body.data.refreshToken });

    expect(ended.status).toBe(200);
    expect(phoneRefresh.status).toBe(401);
  });

  it('should log out every other device but keep this one', async () => {
    const laptop = await login(CHROME_WINDOWS);
    const phone = await login(SAFARI_IPHONE);

    await request(context.app).post('/api/me/sessions/log-out-others').set(auth(laptop.body.data.token));
    const laptopRefresh = await request(context.app).post('/api/auth/refresh').send({ refreshToken: laptop.body.data.refreshToken });
    const phoneRefresh = await request(context.app).post('/api/auth/refresh').send({ refreshToken: phone.body.data.refreshToken });

    expect(laptopRefresh.status).toBe(200);
    expect(phoneRefresh.status).toBe(401);
  });

  it("should not let anyone end someone else's session", async () => {
    const ana = await login(CHROME_WINDOWS);
    await createTestUser(context.db, 'admin', { email: 'bo@example.com' });
    const bo = await request(context.app).post('/api/auth/login').send({ email: 'bo@example.com', password: TEST_PASSWORD });
    const anaSessions = await request(context.app).get('/api/me/sessions').set(auth(ana.body.data.token));

    const attempt = await request(context.app)
      .delete(`/api/me/sessions/${anaSessions.body.data[0].id}`)
      .set(auth(bo.body.data.token));
    const anaRefresh = await request(context.app).post('/api/auth/refresh').send({ refreshToken: ana.body.data.refreshToken });

    expect(attempt.status).toBe(404);
    expect(anaRefresh.status).toBe(200);
  });
});

describe('describeDevice', () => {
  it('should name common browsers and systems in plain words', () => {
    expect(describeDevice(CHROME_WINDOWS)).toBe('Chrome on Windows');
    expect(describeDevice(SAFARI_IPHONE)).toBe('Safari on iPhone');
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Gecko/20100101 Firefox/131.0')).toBe('Firefox on Mac');
    expect(describeDevice('okhttp/4.12.0')).toBe('4VD app');
    expect(describeDevice(null)).toBe('Unknown device');
  });
});
