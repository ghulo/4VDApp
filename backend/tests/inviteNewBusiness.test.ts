import { sql } from 'kysely';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createContainer } from '../src/container.js';
import { createDatabase, type DatabaseClient } from '../src/database/connection.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { UserRepository } from '../src/repositories/UserRepository.js';
import { createTestUser, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

/**
 * Live bug (2026-11-18): accepting an invite (name + password) answered 500.
 * Business 1 works; these accept invites into a business made by Add business.
 */

let context: TestContext;
let developer: string;
let appDb: DatabaseClient;

/** Like fourvd_app live: an ordinary role that owns nothing, with the same grants. */
const APP_ROLE = 'four_vd_app_tester_app';

beforeAll(async () => {
  const base = await setupTestApp();
  const admin = createDatabase(base.config.databaseUrl, { poolSize: 1 });
  await sql`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sql.lit(APP_ROLE)}) THEN CREATE ROLE ${sql.raw(APP_ROLE)} NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$`.execute(admin);
  for (const grant of ['USAGE ON SCHEMA public', 'SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public', 'USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public', 'EXECUTE ON ALL FUNCTIONS IN SCHEMA public']) {
    await sql`GRANT ${sql.raw(grant)} TO ${sql.raw(APP_ROLE)}`.execute(admin);
  }
  await admin.destroy();
  // The app on the non-owner role, as live; setup still writes as the owner.
  appDb = createDatabase(base.config.databaseUrl, { role: APP_ROLE, poolSize: 4 });
  const container = createContainer(base.config, appDb, { aiProvider: null, emailSender: { send: async () => undefined } });
  context = { ...base, app: createApp(base.config, appDb, { container }), container };
});
beforeEach(async () => {
  await resetData(context.db);
  developer = await loginAs(context, 'developer');
});
afterAll(async () => {
  await appDb.destroy();
  await context.db.destroy();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
async function linkSentTo(to: string): Promise<string> {
  const email = await context.db.selectFrom('email_outbox').select('text').where('to_address', '=', to).orderBy('id', 'desc').executeTakeFirstOrThrow();
  return /https?:\/\/\S+/.exec(email.text)![0];
}
const tokenFrom = (link: string) => link.split('/').at(-1)!;
const accept = (token: string, name = 'Ana Kovač') =>
  request(context.app).post(`/api/auth/invites/${token}/accept`).send({ name, password: 'a-long-password' });

describe('accepting an invite into an added business', () => {
  it("should let the first main admin named in Add business accept, then sign in there", async () => {
    const added = await request(context.app)
      .post('/api/businesses')
      .set(auth(developer))
      .send({ name: 'Bakery', shortName: 'bakery', legalForm: 'company', mainAdminEmail: 'boss@bakery.test' });
    expect(added.status).toBe(201);

    const accepted = await accept(tokenFrom(await linkSentTo('boss@bakery.test')), 'Boss');

    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    const me = await request(context.app).get('/api/auth/me').set(auth(accepted.body.data.token));
    expect(me.status).toBe(200);
  });

  it("should let someone that business's main admin invites accept", async () => {
    await request(context.app)
      .post('/api/businesses')
      .set(auth(developer))
      .send({ name: 'Bakery', shortName: 'bakery', legalForm: 'company', mainAdminEmail: 'boss@bakery.test' });
    const boss = (await accept(tokenFrom(await linkSentTo('boss@bakery.test')), 'Boss')).body.data.token as string;

    const invited = await request(context.app).post('/api/invites').set(auth(boss)).send({ email: 'baker@bakery.test', role: 'employee' });
    expect(invited.status, JSON.stringify(invited.body)).toBe(201);
    const accepted = await accept(tokenFrom(await linkSentTo('baker@bakery.test')), 'Baker');

    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
  });

  it('should let someone invited into business 1 accept (the case that already worked)', async () => {
    const admin = await loginAs(context, 'admin');
    await request(context.app).post('/api/invites').set(auth(admin)).send({ email: 'ana@example.com', role: 'employee' });

    const accepted = await accept(tokenFrom(await linkSentTo('ana@example.com')));

    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
  });
});

describe('accepting an invite for an email whose account was deleted', () => {
  /** Ana joins business 1, sets personal things up, and is deleted there (her home). */
  async function deletedAna(admin: string) {
    await request(context.app).post('/api/invites').set(auth(admin)).send({ email: 'ana@example.com', role: 'family' });
    const first = (await accept(tokenFrom(await linkSentTo('ana@example.com')), 'Old Ana')).body.data;
    const id = first.user.id as number;
    await context.db
      .updateTable('users')
      .set({ phone: '+38344111222', theme: 'dark', pin_hash: 'x', totp_secret: 'secret', totp_enabled_at: new Date(), totp_recovery: sql<string[]>`'{abc}'::text[]`, monthly_target: '900' })
      .where('id', '=', id)
      .execute();
    await context.db.insertInto('passkeys').values({ user_id: id, credential_id: 'cred', public_key: Buffer.from('k'), name: 'Phone' }).execute();
    await context.db.insertInto('push_subscriptions').values({ user_id: id, kind: 'web', token: 'push-token' }).execute();
    await context.db.insertInto('user_identities').values({ user_id: id, provider: 'google', subject: 'google-old-ana', email: 'ana@example.com' }).execute();
    const removed = await request(context.app).delete(`/api/users/${id}`).set(auth(admin));
    expect(removed.status, JSON.stringify(removed.body)).toBeLessThan(300);
    // A token from her old life, signed a minute before she was deleted (they last days).
    const oldToken = jwt.sign({ userId: id, email: 'ana@example.com', role: 'family', bid: 1, iat: Math.floor(Date.now() / 1000) - 60 }, context.config.jwtSecret, { algorithm: 'HS256', expiresIn: '7d' });
    expect((await request(context.app).get('/api/auth/me').set(auth(first.token))).status).toBe(401);
    return { id, oldToken };
  }

  it('should bring the account back as a fresh start, with nothing personal from before', async () => {
    const admin = await loginAs(context, 'admin');
    const { id, oldToken } = await deletedAna(admin);

    const again = await request(context.app).post('/api/invites').set(auth(admin)).send({ email: 'ana@example.com', role: 'employee' });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    const accepted = await accept(tokenFrom(await linkSentTo('ana@example.com')), 'New Ana');

    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    expect(accepted.body.data.user).toMatchObject({ id, name: 'New Ana', role: 'employee' });
    const row = await context.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ deleted_at: null, is_active: true, phone: null, theme: 'system', pin_hash: null, totp_secret: null, totp_enabled_at: null, totp_recovery: [], monthly_target: null });
    for (const table of ['passkeys', 'push_subscriptions', 'user_identities'] as const) {
      expect(await context.db.selectFrom(table).select('id').where('user_id', '=', id).execute(), table).toHaveLength(0);
    }
    const oldRefresh = await context.db.selectFrom('refresh_tokens').select('id').where('user_id', '=', id).where('revoked_at', 'is', null).execute();
    expect(oldRefresh).toHaveLength(1); // only the new session
    expect((await request(context.app).get('/api/auth/me').set(auth(oldToken))).status).toBe(401);
    const signIn = await request(context.app).post('/api/auth/login').send({ email: 'ana@example.com', password: 'a-long-password' });
    expect(signIn.status, JSON.stringify(signIn.body)).toBe(200);
    // The business's history says she joined (twice: the first time and now), never "restored".
    const joined = await context.db.selectFrom('activity_log').select('action').where('entity_id', '=', id).where('action', 'like', 'user.%').orderBy('id').execute();
    expect(joined.map((r) => r.action)).toEqual(['user.created', 'user.deleted', 'user.created']);
  });

  it("should join only the invite's business: the deleted account's other businesses stay removed", async () => {
    const admin = await loginAs(context, 'admin');
    await request(context.app)
      .post('/api/businesses')
      .set(auth(developer))
      .send({ name: 'Bakery', shortName: 'bakery', legalForm: 'company', mainAdminEmail: 'boss@bakery.test' });
    const bakery = await context.db.selectFrom('businesses').select('id').where('name', '=', 'Bakery').executeTakeFirstOrThrow();
    const { id } = await deletedAna(admin);
    // She also worked at the bakery before her account was deleted.
    await context.db.insertInto('memberships').values({ user_id: id, business_id: bakery.id, role: 'employee', is_active: true }).execute();
    // Her notifications from before, in both businesses.
    const notes = (trx: typeof context.db) => trx.selectFrom('notifications').select('business_id').where('user_id', '=', id).orderBy('business_id').execute();
    const asMaintenance = <T>(work: (trx: typeof context.db) => Promise<T>) =>
      context.db.transaction().execute(async (trx) => {
        await sql`select set_config('app.maintenance', 'on', true)`.execute(trx);
        return work(trx as unknown as typeof context.db);
      });
    await asMaintenance((trx) => trx.insertInto('notifications').values([1, bakery.id].map((business_id) => ({ user_id: id, business_id, title: 'Old', message: 'Old' }))).execute());
    expect(await asMaintenance(notes)).toHaveLength(2);

    // The bakery's main admin invites her again: she comes back there only, and business 1 stays removed.
    const bossAccepted = await accept(tokenFrom(await linkSentTo('boss@bakery.test')), 'Boss');
    const boss = bossAccepted.body.data.token as string;
    const invited = await request(context.app).post('/api/invites').set(auth(boss)).send({ email: 'ana@example.com', role: 'employee' });
    expect(invited.status, JSON.stringify(invited.body)).toBe(201);
    const accepted = await accept(tokenFrom(await linkSentTo('ana@example.com')), 'New Ana');

    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    const me = await request(context.app).get('/api/auth/me').set(auth(accepted.body.data.token));
    expect(me.body.data.businesses.map((b: { id: number }) => b.id)).toEqual([bakery.id]);
    const memberships = await context.db.selectFrom('memberships').select(['business_id', 'is_active', 'removed_at']).where('user_id', '=', id).orderBy('business_id').execute();
    expect(memberships.find((m) => m.business_id === 1)).toMatchObject({ is_active: false });
    expect(memberships.find((m) => m.business_id === 1)!.removed_at).not.toBeNull();
    expect(memberships.find((m) => m.business_id === bakery.id)).toMatchObject({ is_active: true, removed_at: null });
    expect(await asMaintenance(notes)).toHaveLength(0);
    // Business 1's history about her stays in business 1.
    const feed = await request(context.app).get('/api/activity').set(auth(boss));
    expect(JSON.stringify(feed.body)).not.toContain('Old Ana');
  });

  it("should bring a deleted account back as the first main admin of an added business", async () => {
    const admin = await loginAs(context, 'admin');
    const { id } = await deletedAna(admin);

    const added = await request(context.app)
      .post('/api/businesses')
      .set(auth(developer))
      .send({ name: 'Bakery', shortName: 'bakery', legalForm: 'company', mainAdminEmail: 'ana@example.com' });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const accepted = await accept(tokenFrom(await linkSentTo('ana@example.com')), 'Ana the baker');

    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    expect(accepted.body.data.user).toMatchObject({ id, role: 'main_admin' });
  });

  it('should answer 409, never 500, when an account insert hits a taken email', async () => {
    const taken = await createTestUser(context.db, 'employee', { email: 'taken@example.com' });
    await context.db.updateTable('users').set({ deleted_at: new Date() }).where('id', '=', taken.id).execute();

    const attempt = new UserRepository(context.db).create({ email: 'taken@example.com', name: 'Twin', role: 'employee', password_hash: null, business_id: 1, email_verified_at: null });

    await expect(attempt).rejects.toMatchObject({ statusCode: 409, code: 'EMAIL_TAKEN' });
  });
});

describe('accepting an invite for an email that has an account in another business', () => {
  it('should answer 409 INVITE_HAS_ACCOUNT, not 500', async () => {
    await request(context.app)
      .post('/api/businesses')
      .set(auth(developer))
      .send({ name: 'Bakery', shortName: 'bakery', legalForm: 'company', mainAdminEmail: 'boss@bakery.test' });
    await accept(tokenFrom(await linkSentTo('boss@bakery.test')), 'Boss');

    const admin = await loginAs(context, 'admin');
    const invited = await request(context.app).post('/api/invites').set(auth(admin)).send({ email: 'boss@bakery.test', role: 'employee' });
    expect(invited.status, JSON.stringify(invited.body)).toBe(201);
    const accepted = await accept(tokenFrom(await linkSentTo('boss@bakery.test')));

    expect(accepted.status, JSON.stringify(accepted.body)).toBe(409);
    expect(accepted.body.error).toBe('INVITE_HAS_ACCOUNT');
  });
});

describe('the last-resort error answer', () => {
  it('should answer a taken email from any path with 409, not 500', () => {
    const sent: { status?: number; body?: { error?: string } } = {};
    const res = { status(code: number) { sent.status = code; return this; }, json(body: { error?: string }) { sent.body = body; return this; } };
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), { code: '23505', constraint: 'users_email_key' });

    errorHandler(pgError, { method: 'POST', originalUrl: '/x' } as never, res as never, () => undefined);

    expect(sent.status).toBe(409);
    expect(sent.body?.error).toBe('EMAIL_TAKEN');
  });
});
