import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

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
const invite = (body: Record<string, unknown>, token = adminToken) =>
  request(context.app).post('/api/invites').set(auth(token)).send(body);

/** The link in the newest queued email to `to`. */
async function linkSentTo(to: string): Promise<string> {
  const email = await context.db
    .selectFrom('email_outbox')
    .select('text')
    .where('to_address', '=', to)
    .orderBy('id', 'desc')
    .executeTakeFirstOrThrow();
  return /https?:\/\/\S+/.exec(email.text)![0];
}
const tokenFrom = (link: string) => link.split('/').at(-1)!;

const accept = (token: string, body: Record<string, unknown> = { name: 'Ana Kovač', password: 'a-long-password' }) =>
  request(context.app).post(`/api/auth/invites/${token}/accept`).send(body);

describe('invites', () => {
  it('should email a link that shows the shop and role', async () => {
    const created = await invite({ email: 'Ana@Example.com', role: 'employee' });
    const link = await linkSentTo('ana@example.com');

    const preview = await request(context.app).get(`/api/auth/invites/${tokenFrom(link)}`);

    expect(created.status).toBe(201);
    expect(link).toMatch(/^http:\/\/localhost:5173\/invite\/[A-Za-z0-9_-]{40,}$/);
    expect(preview.body.data).toMatchObject({ email: 'ana@example.com', role: 'employee', shopName: 'Test shop', invitedBy: 'Test admin' });
  });

  it('should create a verified account and log the person in when accepted', async () => {
    await invite({ email: 'ana@example.com', role: 'employee' });
    const token = tokenFrom(await linkSentTo('ana@example.com'));

    const accepted = await accept(token);
    const user = await context.db.selectFrom('users').selectAll().where('email', '=', 'ana@example.com').executeTakeFirstOrThrow();
    const login = await request(context.app).post('/api/auth/login').send({ email: 'ana@example.com', password: 'a-long-password' });

    expect(accepted.status).toBe(201);
    expect(accepted.body.data).toMatchObject({ token: expect.any(String), user: { name: 'Ana Kovač', role: 'employee' } });
    expect(user.email_verified_at).not.toBeNull();
    expect(login.status).toBe(200);
  });

  it('should refuse a link that was used, cancelled or expired', async () => {
    await invite({ email: 'ana@example.com', role: 'employee' });
    const used = tokenFrom(await linkSentTo('ana@example.com'));
    await accept(used);

    const cancelled = await invite({ email: 'bo@example.com', role: 'family' });
    const cancelledToken = tokenFrom(await linkSentTo('bo@example.com'));
    await request(context.app).delete(`/api/invites/${cancelled.body.data.id}`).set(auth(adminToken));

    await invite({ email: 'cy@example.com', role: 'employee' });
    const expiredToken = tokenFrom(await linkSentTo('cy@example.com'));
    await context.db.updateTable('invites').set({ expires_at: new Date(Date.now() - 1000) }).where('email', '=', 'cy@example.com').execute();

    expect((await accept(used)).status).toBe(410);
    expect((await accept(cancelledToken)).status).toBe(410);
    expect((await request(context.app).get(`/api/auth/invites/${expiredToken}`)).status).toBe(410);
    expect((await accept('not-a-real-token-at-all-0000000000000000000')).status).toBe(410);
  });

  it('should not invite someone who already has an account', async () => {
    await createTestUser(context.db, 'employee', { email: 'ana@example.com' });

    const response = await invite({ email: 'ana@example.com', role: 'employee' });

    expect(response.status).toBe(409);
  });

  it('should refuse to accept if the email got an account in the meantime', async () => {
    await invite({ email: 'ana@example.com', role: 'employee' });
    const token = tokenFrom(await linkSentTo('ana@example.com'));
    await createTestUser(context.db, 'employee', { email: 'ana@example.com' });

    expect((await accept(token)).status).toBe(409);
  });

  it('should list pending invites, resend with a fresh link, and replace an older invite to the same email', async () => {
    const first = await invite({ email: 'ana@example.com', role: 'employee' });
    const oldToken = tokenFrom(await linkSentTo('ana@example.com'));
    await request(context.app).post(`/api/invites/${first.body.data.id}/resend`).set(auth(adminToken));
    const newToken = tokenFrom(await linkSentTo('ana@example.com'));
    await invite({ email: 'ana@example.com', role: 'family' });

    const list = await request(context.app).get('/api/invites').set(auth(adminToken));

    expect(newToken).not.toBe(oldToken);
    expect((await accept(oldToken)).status).toBe(410);
    expect(list.body.data).toEqual([expect.objectContaining({ email: 'ana@example.com', role: 'family', invitedBy: 'Test admin' })]);
  });

  it('should only let admins invite, and want a sensible password', async () => {
    const employeeToken = await loginAs(context, 'employee');
    await invite({ email: 'ana@example.com', role: 'employee' });
    const token = tokenFrom(await linkSentTo('ana@example.com'));

    expect((await invite({ email: 'x@example.com', role: 'employee' }, employeeToken)).status).toBe(403);
    expect((await accept(token, { name: 'Ana', password: 'short' })).status).toBe(400);
  });
});
