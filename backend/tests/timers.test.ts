import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContainer } from '../src/container.js';
import type { DatabaseClient } from '../src/database/connection.js';
import { minuteJobs, pushJobs } from '../src/timers.js';
import { asShop, createLiveLikeDatabase, createTestUser, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

/**
 * The server's timers run outside any request. Under row security, work that
 * isn't inside a business sees no rows and can't write, so each timer must
 * name its business itself. These run them on a handle with no default
 * business, as live.
 */
let context: TestContext;
let live: DatabaseClient;
const sent: string[] = [];

beforeAll(async () => {
  context = await setupTestApp();
  await resetData(context.db);
  live = createLiveLikeDatabase();
});
afterAll(async () => {
  await live.destroy();
  await context.db.destroy();
});

describe('the server timers under row security', () => {
  it('sends the error alert to the developers and remembers the hour in the shop', async () => {
    await createTestUser(context.db, 'developer');
    const container = createContainer(context.config, live, {
      pushSenders: { expo: { send: async () => ({ deadTokens: [] }) }, web: { send: async () => ({ deadTokens: [] }) } },
      aiProvider: null,
      emailSender: { send: async (email: { to: string; subject: string }) => void sent.push(`${email.to}: ${email.subject}`) },
    });
    container.errorAlertService.record('Something broke');

    await minuteJobs(live, container);
    const remembered = await asShop(() => context.db.selectFrom('settings').select('key').where('key', '=', 'error_alert_last_sent').execute());
    expect(remembered).toHaveLength(1);

    // The alert went into the shared outbox; the push timer sends it.
    await pushJobs(live, container);
    expect(sent.filter((line) => line.startsWith('developer@test.local'))).toHaveLength(1);
    const unsent = await context.db.selectFrom('email_outbox').select('id').where('sent_at', 'is', null).execute();
    expect(unsent).toEqual([]);
  });
});
