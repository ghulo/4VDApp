import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OutgoingEmail } from '../src/services/email/senders.js';
import { loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

const BACKUP_TOKEN = 'a-long-backup-secret-for-tests-only';
const sent: OutgoingEmail[] = [];
let failWith: string | null = null;

let context: TestContext;

beforeAll(async () => {
  context = await setupTestApp(
    {
      emailSender: {
        send: async (email) => {
          if (failWith) throw new Error(failWith);
          sent.push(email);
        },
      },
    },
    { RESEND_API_KEY: 'test-key', EMAIL_FROM: '4VD <hello@4vd.app>', BACKUP_PING_TOKEN: BACKUP_TOKEN },
  );
});
beforeEach(async () => {
  await resetData(context.db);
  sent.length = 0;
  failWith = null;
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const checklist = async (token: string) =>
  (await request(context.app).get('/api/settings/launch-checklist').set(auth(token))).body.data as Array<{
    key: string;
    done: boolean | null;
    facts?: Record<string, string>;
  }>;
const ping = (token?: string) => request(context.app).post('/api/internal/backup-ok').set(token ? { 'x-backup-token': token } : {});

describe('test email', () => {
  it('should send the developer a real email and say so', async () => {
    const token = await loginAs(context, 'developer');

    const response = await request(context.app).post('/api/settings/test-email').set(auth(token));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ to: 'developer@test.local', sent: true, reason: null });
    expect(sent.map((email) => [email.to, email.subject])).toEqual([['developer@test.local', 'Test email from 4VD']]);
  });

  it("should pass on the email service's complaint instead of hiding it", async () => {
    const token = await loginAs(context, 'developer');
    failWith = 'validation_error: The 4vd.app domain is not verified';

    const response = await request(context.app).post('/api/settings/test-email').set(auth(token));

    expect(response.body.data).toMatchObject({ sent: false, reason: expect.stringContaining('domain is not verified') });
  });

  it('should be for the developer only', async () => {
    const response = await request(context.app).post('/api/settings/test-email').set(auth(await loginAs(context, 'admin')));

    expect(response.status).toBe(403);
    expect(sent).toHaveLength(0);
  });
});

describe('backup check', () => {
  let developerToken: string;
  beforeEach(async () => {
    developerToken = await loginAs(context, 'developer');
  });
  const step = async () => (await checklist(developerToken)).find((item) => item.key === 'backups')!;

  it('should stay "not done" until the backup job reports in, then tick', async () => {
    expect((await step()).done).toBe(false);

    expect((await ping(BACKUP_TOKEN)).status).toBe(200);

    const done = await step();
    expect(done.done).toBe(true);
    expect(done.facts?.lastBackupAt).toBeTruthy();
  });

  it('should go back to "not done" when the last backup is more than a week and a bit old', async () => {
    await ping(BACKUP_TOKEN);
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await context.db.updateTable('settings').set({ value: JSON.stringify(old) }).where('key', '=', 'last_backup_at').execute();

    expect((await step()).done).toBe(false);
  });

  it('should refuse a missing or wrong token', async () => {
    expect((await ping()).status).toBe(401);
    expect((await ping('not-the-token')).status).toBe(401);
    expect((await step()).done).toBe(false);
  });
});
