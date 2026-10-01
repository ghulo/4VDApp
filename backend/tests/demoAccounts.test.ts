import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_ACCOUNTS, seedDemoAccounts } from '../src/scripts/demoAccounts.js';
import { resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(() => resetData(context.db));
afterAll(() => context.db.destroy());

describe('demo accounts', () => {
  it('should refuse to create demo accounts on a production database', async () => {
    await expect(seedDemoAccounts(context.db, 'production')).rejects.toThrow(/production/);

    const users = await context.db.selectFrom('users').select('email').execute();
    expect(users).toEqual([]);
  });

  it('should create an admin, an employee and a family account that can log in', async () => {
    await seedDemoAccounts(context.db, 'development');

    for (const account of DEMO_ACCOUNTS) {
      const login = await request(context.app).post('/api/auth/login').send({ email: account.email, password: account.password });
      expect(login.status).toBe(200);
      expect(login.body.data.user.role).toBe(account.role);
    }
  });

  it('should reset a demo account that was changed or switched off', async () => {
    await seedDemoAccounts(context.db, 'development');
    const employee = DEMO_ACCOUNTS.find((account) => account.role === 'employee')!;
    await context.db.updateTable('users').set({ is_active: false, password_hash: 'x' }).where('email', '=', employee.email).execute();

    await seedDemoAccounts(context.db, 'development');
    const login = await request(context.app).post('/api/auth/login').send({ email: employee.email, password: employee.password });
    const count = await context.db.selectFrom('users').select('id').where('email', '=', employee.email).execute();

    expect(login.status).toBe(200);
    expect(count).toHaveLength(1);
  });
});
