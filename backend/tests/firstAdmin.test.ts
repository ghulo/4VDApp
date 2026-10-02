import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureFirstAdmin } from '../src/database/firstAdmin.js';
import { createTestUser, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(() => resetData(context.db));
afterAll(() => context.db.destroy());

const owner = { email: 'Owner@Shop.com ', password: 'a-long-enough-password', name: 'Owner' };
const admins = () => context.db.selectFrom('users').select(['email', 'role']).where('role', 'in', ['developer', 'admin']).execute();

describe('ensureFirstAdmin', () => {
  it('should create the owner on an empty server, once', async () => {
    const first = await ensureFirstAdmin(context.db, owner);
    const second = await ensureFirstAdmin(context.db, owner);

    expect([first, second]).toEqual(['created', 'skipped']);
    // Whoever sets up the server runs it: they become the developer.
    expect(await admins()).toEqual([{ email: 'owner@shop.com', role: 'developer' }]);
  });

  it('should do nothing when an admin already exists, even with a different email', async () => {
    await createTestUser(context.db, 'admin');

    expect(await ensureFirstAdmin(context.db, owner)).toBe('skipped');
    expect(await admins()).toHaveLength(1);
  });

  it('should do nothing without both settings, or with a short password', async () => {
    expect(await ensureFirstAdmin(context.db, { email: 'owner@shop.com' })).toBe('skipped');
    expect(await ensureFirstAdmin(context.db, { ...owner, password: 'short' })).toBe('skipped');
    expect(await admins()).toHaveLength(0);
  });
});
