import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

const NEW_SHOP = { shopName: 'Dacaj Furniture', name: 'Arben Dacaj', email: 'arben@example.com', password: 'a-long-password' };

describe('sign-up while switched off', () => {
  let context: TestContext;
  beforeAll(async () => {
    context = await setupTestApp();
  });
  afterAll(() => context.db.destroy());

  it('should not exist', async () => {
    const response = await request(context.app).post('/api/auth/signup').send(NEW_SHOP);

    expect(response.status).toBe(404);
  });
});

describe('sign-up when switched on', () => {
  let context: TestContext;
  beforeAll(async () => {
    context = await setupTestApp({}, { ALLOW_SIGNUP: 'true' });
  });
  beforeEach(() => resetData(context.db));
  afterAll(() => context.db.destroy());

  it('should create the shop and its owner, who must confirm their email before logging in', async () => {
    const signup = await request(context.app).post('/api/auth/signup').send(NEW_SHOP);
    const blocked = await request(context.app).post('/api/auth/login').send({ email: NEW_SHOP.email, password: NEW_SHOP.password });
    const email = await context.db.selectFrom('email_outbox').select('text').where('to_address', '=', NEW_SHOP.email).executeTakeFirstOrThrow();
    await request(context.app).post('/api/auth/verify-email').send({ token: /verify-email\/(\S+)/.exec(email.text)![1] });
    const login = await request(context.app).post('/api/auth/login').send({ email: NEW_SHOP.email, password: NEW_SHOP.password });
    const business = await request(context.app).get('/api/business').set({ Authorization: `Bearer ${login.body.data.token}` });

    expect(signup.status).toBe(201);
    expect(blocked.status).toBe(401);
    expect(login.status).toBe(200);
    expect(login.body.data.user.role).toBe('admin');
    expect(business.body.data.name).toBe('Dacaj Furniture');
  });

  it('should refuse an email that already has an account', async () => {
    await request(context.app).post('/api/auth/signup').send(NEW_SHOP);

    const again = await request(context.app).post('/api/auth/signup').send({ ...NEW_SHOP, shopName: 'Another shop' });

    expect(again.status).toBe(409);
  });
});
