import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UnauthorizedError } from '../src/errors/httpErrors.js';
import type { GoogleProfile, GoogleVerifier } from '../src/services/google/googleVerifier.js';
import { createTestUser, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

/** Treats the "credential" as a key into made-up Google profiles. */
const PROFILES: Record<string, GoogleProfile> = {
  ana: { subject: 'google-ana', email: 'ana@example.com', emailVerified: true, name: 'Ana Kovač' },
  anaUnverified: { subject: 'google-ana-2', email: 'ana@example.com', emailVerified: false, name: 'Ana' },
  stranger: { subject: 'google-x', email: 'stranger@example.com', emailVerified: true, name: 'Stranger' },
};
const fakeGoogle: GoogleVerifier = {
  async verify(credential: string) {
    const profile = PROFILES[credential];
    if (!profile) throw new UnauthorizedError('Google sign-in failed. Try again.');
    return profile;
  },
};

let context: TestContext;

beforeAll(async () => {
  context = await setupTestApp({ google: { verifier: fakeGoogle, clientId: 'test-client-id' } });
});
beforeEach(() => resetData(context.db));
afterAll(() => context.db.destroy());

const google = (credential: string) => request(context.app).post('/api/auth/google').send({ credential });

describe('Google sign-in', () => {
  it('should link on first use when the verified Google email matches, then sign in by the link', async () => {
    await createTestUser(context.db, 'employee', { email: 'ana@example.com' });

    const first = await google('ana');
    await context.db.updateTable('users').set({ email: 'ana.renamed@example.com' }).execute();
    const second = await google('ana');

    expect(first.status).toBe(200);
    expect(first.body.data.user.email).toBe('ana@example.com');
    // Still signs in after the email changed, because the Google account is linked.
    expect(second.status).toBe(200);
  });

  it('should never create an account, or link an unverified Google email', async () => {
    await createTestUser(context.db, 'employee', { email: 'ana@example.com' });

    const stranger = await google('stranger');
    const unverified = await google('anaUnverified');
    const bogus = await google('forged-token');
    const users = await context.db.selectFrom('users').select('email').execute();

    expect(stranger.status).toBe(401);
    expect(stranger.body.message).toContain('invite');
    expect(unverified.status).toBe(401);
    expect(bogus.status).toBe(401);
    expect(users).toHaveLength(1);
  });

  it('should accept an invite with Google when the emails match, without a password', async () => {
    const adminToken = await loginAs(context, 'admin');
    await request(context.app).post('/api/invites').set({ Authorization: `Bearer ${adminToken}` }).send({ email: 'ana@example.com', role: 'employee' });
    const email = await context.db.selectFrom('email_outbox').select('text').where('to_address', '=', 'ana@example.com').executeTakeFirstOrThrow();
    const token = /invite\/(\S+)/.exec(email.text)![1]!;

    const wrongPerson = await request(context.app).post(`/api/auth/invites/${token}/google`).send({ credential: 'stranger' });
    const accepted = await request(context.app).post(`/api/auth/invites/${token}/google`).send({ credential: 'ana' });
    const user = await context.db.selectFrom('users').selectAll().where('email', '=', 'ana@example.com').executeTakeFirstOrThrow();

    expect(wrongPerson.status).toBe(403);
    expect(accepted.status).toBe(201);
    expect(user).toMatchObject({ name: 'Ana Kovač', password_hash: null });
    expect(user.email_verified_at).not.toBeNull();
    expect((await google('ana')).status).toBe(200);
  });

  it('should show and remove the link from the security settings', async () => {
    await createTestUser(context.db, 'employee', { email: 'ana@example.com' });
    const session = await google('ana');
    const auth = { Authorization: `Bearer ${session.body.data.token}` };

    const security = await request(context.app).get('/api/me/security').set(auth);
    const unlinked = await request(context.app).delete('/api/me/google').set(auth);
    const after = await request(context.app).get('/api/me/security').set(auth);

    expect(security.body.data).toEqual({ hasPassword: true, googleEmail: 'ana@example.com' });
    expect(unlinked.status).toBe(200);
    expect(after.body.data.googleEmail).toBeNull();
  });

  it('should not remove Google from an account with no password, or it could never log in', async () => {
    const adminToken = await loginAs(context, 'admin');
    await request(context.app).post('/api/invites').set({ Authorization: `Bearer ${adminToken}` }).send({ email: 'ana@example.com', role: 'employee' });
    const email = await context.db.selectFrom('email_outbox').select('text').where('to_address', '=', 'ana@example.com').executeTakeFirstOrThrow();
    const accepted = await request(context.app).post(`/api/auth/invites/${/invite\/(\S+)/.exec(email.text)![1]}/google`).send({ credential: 'ana' });

    const unlink = await request(context.app).delete('/api/me/google').set({ Authorization: `Bearer ${accepted.body.data.token}` });

    expect(unlink.status).toBe(409);
  });

  it('should say whether Google sign-in is on', async () => {
    const response = await request(context.app).get('/api/auth/google');

    expect(response.body.data).toEqual({ enabled: true, clientId: 'test-client-id' });
  });
});
