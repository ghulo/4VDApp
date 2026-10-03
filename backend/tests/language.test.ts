import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { en, sq } from '../src/i18n/messages.js';
import { createTestProduct, createTestUser, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);
const setLanguage = (token: string, language: string) => api().put('/api/me/profile').set(auth(token)).send({ language });

async function newestEmailTo(to: string) {
  return context.db
    .selectFrom('email_outbox')
    .select(['subject', 'text', 'html'])
    .where('to_address', '=', to)
    .orderBy('id', 'desc')
    .executeTakeFirstOrThrow();
}

describe('choosing a language', () => {
  it('should start in English and save Albanian on the profile', async () => {
    const before = await api().get('/api/auth/me').set(auth(adminToken));
    await setLanguage(adminToken, 'sq');
    const after = await api().get('/api/auth/me').set(auth(adminToken));

    expect(before.body.data.language).toBe('en');
    expect(after.body.data.language).toBe('sq');
  });

  it('should refuse a language 4VD does not speak', async () => {
    const response = await setLanguage(adminToken, 'de');

    expect(response.status).toBe(400);
  });
});

describe('alerts in each person’s language', () => {
  it('should write a stock alert in Albanian for Albanian readers and English for the rest', async () => {
    const ownerToken = await loginAs(context, 'owner');
    await setLanguage(ownerToken, 'sq');
    const productId = await createTestProduct(context, adminToken, { stock: 12, reorderLevel: 10 });

    await api().post('/api/sales').set(auth(adminToken)).send({ productId, quantity: 3 });
    const forAdmin = await api().get('/api/notifications').set(auth(adminToken));
    const forOwner = await api().get('/api/notifications').set(auth(ownerToken));

    expect(forAdmin.body.data.notifications[0].title).toBe(en.lowStockTitle('Oak Chair'));
    expect(forOwner.body.data.notifications[0].title).toBe(sq.lowStockTitle('Oak Chair'));
  });

  it('should list what needs attention in the reader’s language', async () => {
    const productId = await createTestProduct(context, adminToken, { stock: 1, reorderLevel: 0 });
    await api().post('/api/sales').set(auth(adminToken)).send({ productId, quantity: 1 });
    await setLanguage(adminToken, 'sq');

    const insights = await api().get('/api/reports/insights').set(auth(adminToken));

    expect(insights.body.data[0].title).toBe(sq.insight.soldOutTitle('Oak Chair'));
  });
});

describe('emails in each person’s language', () => {
  it('should send the reset-password email in Albanian to an Albanian reader', async () => {
    await setLanguage(adminToken, 'sq');

    await api().post('/api/auth/forgot-password').send({ email: 'admin@test.local' });
    const email = await newestEmailTo('admin@test.local');

    expect(email.subject).toBe(sq.email.resetSubject);
    expect(email.html).toContain('lang="sq"');
  });

  it('should send an invite in the language the inviter picked, and start the account in it', async () => {
    await api().post('/api/invites').set(auth(adminToken)).send({ email: 'ana@example.com', role: 'employee', language: 'sq' });
    const email = await newestEmailTo('ana@example.com');
    const token = /https?:\/\/\S+/.exec(email.text)![0].split('/').at(-1)!;
    const accepted = await api()
      .post(`/api/auth/invites/${token}/accept`)
      .send({ name: 'Ana Kovač', password: 'a-long-password' });

    expect(email.text).toContain(sq.email.inviteButton);
    expect(accepted.body.data.user.language).toBe('sq');
  });

  it('should send an invite in the inviter’s own language when none is picked', async () => {
    await setLanguage(adminToken, 'sq');

    await api().post('/api/invites').set(auth(adminToken)).send({ email: 'ana@example.com', role: 'employee' });
    const email = await newestEmailTo('ana@example.com');

    expect(email.text).toContain(sq.email.inviteButton);
  });

  it('should send the weekly report in each recipient’s language', async () => {
    await createTestUser(context.db, 'owner');
    await context.db.updateTable('users').set({ language: 'sq' }).where('email', '=', 'owner@test.local').execute();

    await context.container.weeklyReportService.sendIfDue(new Date('2026-10-05T20:00:00Z'));
    const toOwner = await newestEmailTo('owner@test.local');
    const toAdmin = await newestEmailTo('admin@test.local');

    expect(toOwner.text).toContain(sq.email.weeklyButton);
    expect(toAdmin.text).toContain(en.email.weeklyButton);
  });
});
