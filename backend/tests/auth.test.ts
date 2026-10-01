import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, resetData, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers/testApp.js';

let context: TestContext;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(() => resetData(context.db));
afterAll(() => context.db.destroy());

const login = (email: string, password: string) =>
  request(context.app).post('/api/auth/login').send({ email, password });

describe('POST /api/auth/login', () => {
  it('should return tokens and the user without the password hash', async () => {
    await createTestUser(context.db, 'admin');

    const response = await login('admin@test.local', TEST_PASSWORD);

    expect(response.status).toBe(200);
    expect(response.body.data.token).toEqual(expect.any(String));
    expect(response.body.data.refreshToken).toEqual(expect.any(String));
    expect(response.body.data.user).toMatchObject({ email: 'admin@test.local', role: 'admin' });
    expect(JSON.stringify(response.body)).not.toContain('password');
  });

  it('should accept the email in any letter case', async () => {
    await createTestUser(context.db, 'employee');

    const response = await login('EMPLOYEE@Test.Local', TEST_PASSWORD);

    expect(response.status).toBe(200);
  });

  it('should give the same error for a wrong password and an unknown email', async () => {
    await createTestUser(context.db, 'admin');

    const wrongPassword = await login('admin@test.local', 'wrong-password');
    const unknownEmail = await login('nobody@test.local', TEST_PASSWORD);

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
  });

  it('should reject deactivated accounts', async () => {
    await createTestUser(context.db, 'family', { isActive: false });

    const response = await login('family@test.local', TEST_PASSWORD);

    expect(response.status).toBe(401);
  });

  it('should explain every validation problem', async () => {
    const response = await request(context.app).post('/api/auth/login').send({ email: 'not-an-email' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/email/);
    expect(response.body.message).toMatch(/password/);
  });
});

describe('GET /api/auth/me', () => {
  it('should return the logged-in user', async () => {
    await createTestUser(context.db, 'employee');
    const { body } = await login('employee@test.local', TEST_PASSWORD);

    const response = await request(context.app).get('/api/auth/me').set('Authorization', `Bearer ${body.data.token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.email).toBe('employee@test.local');
  });

  it('should reject requests without a token', async () => {
    const response = await request(context.app).get('/api/auth/me');

    expect(response.status).toBe(401);
  });

  it('should reject a forged token', async () => {
    const response = await request(context.app).get('/api/auth/me').set('Authorization', 'Bearer not.a.real.token');

    expect(response.status).toBe(401);
  });

  it('should lock out a user as soon as they are deactivated', async () => {
    const user = await createTestUser(context.db, 'employee');
    const { body } = await login(user.email, TEST_PASSWORD);
    await context.db.updateTable('users').set({ is_active: false }).where('id', '=', user.id).execute();

    const response = await request(context.app).get('/api/auth/me').set('Authorization', `Bearer ${body.data.token}`);

    expect(response.status).toBe(401);
  });
});

describe('POST /api/auth/refresh', () => {
  it('should issue new tokens and make the old refresh token unusable', async () => {
    await createTestUser(context.db, 'admin');
    const { body } = await login('admin@test.local', TEST_PASSWORD);
    const originalRefreshToken = body.data.refreshToken;

    const first = await request(context.app).post('/api/auth/refresh').send({ refreshToken: originalRefreshToken });
    const reused = await request(context.app).post('/api/auth/refresh').send({ refreshToken: originalRefreshToken });

    expect(first.status).toBe(200);
    expect(first.body.data.refreshToken).not.toBe(originalRefreshToken);
    expect(reused.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('should revoke the given refresh token', async () => {
    await createTestUser(context.db, 'admin');
    const { body } = await login('admin@test.local', TEST_PASSWORD);

    const logout = await request(context.app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${body.data.token}`)
      .send({ refreshToken: body.data.refreshToken });
    const refreshAfterLogout = await request(context.app)
      .post('/api/auth/refresh')
      .send({ refreshToken: body.data.refreshToken });

    expect(logout.status).toBe(200);
    expect(refreshAfterLogout.status).toBe(401);
  });
});
