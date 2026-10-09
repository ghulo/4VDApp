import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { wipeShopData } from '../src/scripts/wipeShopData.js';
import { createTestUser, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
});
afterAll(() => context.db.destroy());

const emailsTo = async (to: string) =>
  context.db.selectFrom('email_outbox').select(['subject', 'text']).where('to_address', '=', to).execute();

describe('error alerts', () => {
  it('should email developers at most once an hour, counting repeats', async () => {
    await createTestUser(context.db, 'developer', { email: 'dev@test.local' });
    await createTestUser(context.db, 'admin');
    const alerts = context.container.errorAlertService;
    const noon = new Date('2026-10-04T12:00:00Z');

    expect(await alerts.sendIfDue(noon)).toBe(false);
    alerts.record('Unhandled error', { method: 'GET', path: '/api/sales', error: 'boom' });
    alerts.record('Unhandled error', { method: 'GET', path: '/api/sales', error: 'boom' });
    alerts.record('Sending emails failed', { error: 'timeout' });
    expect(await alerts.sendIfDue(noon)).toBe(true);

    // A later error in the same hour waits for the next hour.
    alerts.record('Sending emails failed', { error: 'timeout' });
    expect(await alerts.sendIfDue(new Date('2026-10-04T12:30:00Z'))).toBe(false);
    expect(await alerts.sendIfDue(new Date('2026-10-04T13:01:00Z'))).toBe(true);

    const emails = await emailsTo('dev@test.local');
    expect(emails).toHaveLength(2);
    expect(emails[0]!.subject).toBe('4VD ran into 3 errors');
    expect(emails[0]!.text).toContain('2× Unhandled error (GET /api/sales): boom');
    expect(await emailsTo('admin@test.local')).toHaveLength(0);
  });
});

describe('launch checklist', () => {
  const checklist = async (token: string) =>
    request(context.app).get('/api/settings/launch-checklist').set({ Authorization: `Bearer ${token}` });
  const step = (body: { data: Array<{ key: string; done: boolean | null }> }, key: string) =>
    body.data.find((item) => item.key === key)!.done;

  it('should be for the developer only', async () => {
    expect((await checklist(await loginAs(context, 'admin'))).status).toBe(403);
    expect((await checklist(await loginAs(context, 'owner'))).status).toBe(403);
  });

  it('should tick steps off from the data itself', async () => {
    const token = await loginAs(context, 'developer');
    const before = (await checklist(token)).body;
    expect(step(before, 'wiped')).toBe(false);
    expect(step(before, 'owner')).toBe(false);
    expect(step(before, 'team')).toBe(false);
    expect(step(before, 'backups')).toBeNull();

    await createTestUser(context.db, 'owner');
    await createTestUser(context.db, 'employee');
    await wipeShopData(context.db, { apply: true });
    // The wipe removes everyone but developers, so add the real team back.
    await createTestUser(context.db, 'owner');
    await createTestUser(context.db, 'employee');

    const after = (await checklist(token)).body;
    expect(step(after, 'wiped')).toBe(true);
    expect(step(after, 'owner')).toBe(true);
    expect(step(after, 'team')).toBe(true);
    expect(step(after, 'reports')).toBe(true);
  });
});
