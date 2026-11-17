import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAsBusiness } from '../src/database/businessContext.js';
import { createDatabase, type DatabaseClient } from '../src/database/connection.js';
import { createBusiness } from '../src/database/newBusiness.js';
import { hashPassword } from '../src/utils/password.js';
import { signAccessToken } from '../src/utils/tokens.js';
import { createLiveLikeDatabase, createTestUser, loginAs, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers/testApp.js';

/**
 * Phase 5b: "developer" is 4VD's own staff, above every business. The flag can
 * only be set on the database by hand, his visits to a customer's business are
 * kept for that business, and the app's own database role can't read across
 * businesses with app.maintenance or app.system.
 */

/** Like fourvd_app live: an ordinary role that owns nothing, with the same grants. */
const APP_ROLE = 'four_vd_app_tester_app';

let context: TestContext;
let live: DatabaseClient;
let admin: DatabaseClient;
let asApp: DatabaseClient;
let otherId: number;
let otherMainAdminToken: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  context = await setupTestApp();
  live = createLiveLikeDatabase();
  admin = createDatabase(context.config.databaseUrl, { poolSize: 1 });
  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sql.lit(APP_ROLE)}) THEN
        CREATE ROLE ${sql.raw(APP_ROLE)} NOLOGIN NOSUPERUSER NOBYPASSRLS;
      END IF;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
    END $$
  `.execute(admin);
  await sql`GRANT USAGE ON SCHEMA public TO ${sql.raw(APP_ROLE)}`.execute(admin);
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${sql.raw(APP_ROLE)}`.execute(admin);
  await sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${sql.raw(APP_ROLE)}`.execute(admin);
  await sql`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${sql.raw(APP_ROLE)}`.execute(admin);
  asApp = createDatabase(context.config.databaseUrl, { role: APP_ROLE, poolSize: 2 });

  const passwordHash = await hashPassword(TEST_PASSWORD);
  otherId = await createBusiness(live, 'Dacaj Furniture', async (trx, businessId) => {
    await trx
      .insertInto('users')
      .values({ email: 'founder@furniture.test', name: 'Founder', role: 'main_admin', password_hash: passwordHash, business_id: businessId, email_verified_at: new Date() })
      .execute();
    return businessId;
  });
  const login = await request(context.app).post('/api/auth/login').send({ email: 'founder@furniture.test', password: TEST_PASSWORD });
  otherMainAdminToken = login.body.data.token as string;
});
afterAll(async () => {
  await asApp.destroy();
  await admin.destroy();
  await live.destroy();
  await context.db.destroy();
});

/** A developer's access token for `businessId`, as the business picker will issue it (phase 5c). */
async function developerIn(businessId: number | undefined): Promise<{ token: string; id: number }> {
  const developer = (await context.db.selectFrom('users').select(['id', 'email']).where('email', '=', 'developer@test.local').executeTakeFirst()) ?? (await createTestUser(context.db, 'developer'));
  const token = signAccessToken(
    { userId: developer.id, email: developer.email, role: 'developer', sessionId: `s-${businessId ?? 'home'}`, businessId },
    context.config.jwtSecret,
    context.config.jwtExpiresIn,
  );
  return { token, id: developer.id };
}

describe('the 4VD developer flag', () => {
  it('can only be set on the database by its owner, never by the app role', async () => {
    const person = await createTestUser(context.db, 'admin', { email: 'flag@test.local' });
    await expect(
      runAsBusiness(1, () => asApp.updateTable('users').set({ is_platform_developer: true }).where('id', '=', person.id).execute()),
    ).rejects.toThrow(/set by hand/);
    await expect(
      runAsBusiness(1, () =>
        asApp.insertInto('users').values({ email: 'sneaky@test.local', name: 'Sneaky', role: 'admin', business_id: 1, is_platform_developer: true }).execute(),
      ),
    ).rejects.toThrow(/set by hand/);

    await context.db.updateTable('users').set({ is_platform_developer: true }).where('id', '=', person.id).execute();
    const row = await context.db.selectFrom('users').select('is_platform_developer').where('id', '=', person.id).executeTakeFirstOrThrow();
    expect(row.is_platform_developer).toBe(true);
  });

  it('is never a role a business can store or hand out', async () => {
    const token = await loginAs(context, 'main_admin', { email: 'boss@test.local' });
    const created = await request(context.app).post('/api/users').set(auth(token)).send({ email: 'dev2@test.local', name: 'Dev', role: 'developer', password: 'long-enough-password' });
    expect(created.status).toBe(400);
    const invited = await request(context.app).post('/api/invites').set(auth(token)).send({ email: 'dev3@test.local', role: 'developer' });
    expect(invited.status).toBe(400);
    await expect(context.db.updateTable('memberships').set({ role: 'developer' as never }).where('business_id', '=', 1).execute()).rejects.toThrow(/memberships_role_check/);
  });
});

describe('opening another business', () => {
  it('lets the developer into any business with every power, seeing only that business', async () => {
    const { token } = await developerIn(otherId);
    const me = await request(context.app).get('/api/auth/me').set(auth(token));
    expect(me.status).toBe(200);
    expect(me.body.data.role).toBe('developer');

    await context.db.insertInto('categories').values({ name: 'Home only' }).execute();
    const categories = await request(context.app).get('/api/categories').set(auth(token));
    expect(categories.status).toBe(200);
    expect(JSON.stringify(categories.body.data)).not.toContain('Home only');
  });

  it("keeps his visit and changes for that business's leaders, not for anyone else", async () => {
    const { token } = await developerIn(otherId);
    const made = await request(context.app).post('/api/categories').set(auth(token)).send({ name: 'Chairs' });
    expect(made.status).toBe(201);

    const visits = await request(context.app).get('/api/support-visits').set(auth(otherMainAdminToken));
    expect(visits.status).toBe(200);
    const [visit] = visits.body.data as Array<{ developerName: string; actions: Array<{ method: string; entity: string }> }>;
    expect(visit?.developerName).toBe('Test developer');
    expect(visit?.actions).toEqual([expect.objectContaining({ method: 'POST', entity: 'categories' })]);

    // The first shop's main admin sees none of it.
    const home = await loginAs(context, 'main_admin', { email: 'home-boss@test.local' });
    const homeVisits = await request(context.app).get('/api/support-visits').set(auth(home));
    expect(homeVisits.body.data).toEqual([]);

    // An employee of the visited business can't read the list.
    const employee = await request(context.app).get('/api/support-visits').set(auth(await loginAs(context, 'employee')));
    expect(employee.status).toBe(403);
  });

  it('keeps no visit in his own business', async () => {
    const { token } = await developerIn(undefined);
    const me = await request(context.app).get('/api/auth/me').set(auth(token));
    expect(me.status).toBe(200);
    const rows = await runAsBusiness(1, () => context.db.selectFrom('support_visits').select('id').execute());
    expect(rows).toEqual([]);
  });

  it("can't be wiped or rewritten by the app", async () => {
    await expect(runAsBusiness(otherId, () => asApp.deleteFrom('support_visits').execute())).rejects.toThrow(/kept/);
    await expect(runAsBusiness(otherId, () => asApp.updateTable('support_actions').set({ path: '/nothing' }).execute())).rejects.toThrow(/kept/);
  });

  it('does not let anyone else open a business by naming it in the token', async () => {
    const employee = await createTestUser(context.db, 'admin', { email: 'nosy@test.local' });
    const token = signAccessToken({ userId: employee.id, email: employee.email, role: 'admin', businessId: otherId }, context.config.jwtSecret, context.config.jwtExpiresIn);
    const made = await request(context.app).post('/api/categories').set(auth(token)).send({ name: 'Stolen' });
    expect(made.status).toBe(201);
    const inOther = await runAsBusiness(otherId, () => context.db.selectFrom('categories').select('name').where('name', '=', 'Stolen').execute());
    expect(inOther).toEqual([]);
  });
});

describe("the developer's own account", () => {
  it('works on people in a business he visits (his own row is readable there)', async () => {
    const { token } = await developerIn(otherId);
    const founder = await runAsBusiness(otherId, () => context.db.selectFrom('users').select('id').where('email', '=', 'founder@furniture.test').executeTakeFirstOrThrow());
    const renamed = await request(context.app).put(`/api/users/${founder.id}`).set(auth(token)).send({ name: 'Founder Two' });
    expect(renamed.status).toBe(200);
    const invited = await request(context.app).post('/api/invites').set(auth(token)).send({ email: 'helper@furniture.test', role: 'employee' });
    expect(invited.status).toBe(201);
    // Not listed among the business's own people.
    const people = await request(context.app).get('/api/users').set(auth(otherMainAdminToken));
    expect(JSON.stringify(people.body.data)).not.toContain('developer@test.local');
  });

  it('can only be changed by himself', async () => {
    const { token, id } = await developerIn(undefined);
    const boss = await loginAs(context, 'main_admin', { email: 'rival@test.local' });
    expect((await request(context.app).put(`/api/users/${id}`).set(auth(boss)).send({ name: 'Taken over' })).status).toBe(403);
    expect((await request(context.app).post(`/api/users/${id}/passkeys/reset`).set(auth(boss))).status).toBe(403);
    expect((await request(context.app).post(`/api/users/${id}/two-step/reset`).set(auth(boss))).status).toBe(403);
    expect((await request(context.app).delete(`/api/users/${id}`).set(auth(boss))).status).toBe(403);
    expect((await request(context.app).put(`/api/users/${id}`).set(auth(token)).send({ name: 'Test developer' })).status).toBe(200);
  });
});

describe('the support log for the app role', () => {
  it("moves only a visit's last_seen_at, and sets an action's status once", async () => {
    const { id } = await developerIn(otherId);
    await runAsBusiness(otherId, async () => {
      const visit = await asApp.insertInto('support_visits').values({ developer_id: id, developer_name: 'Dev', session_id: 'app-role' }).returning('id').executeTakeFirstOrThrow();
      await asApp.updateTable('support_visits').set({ last_seen_at: new Date() }).where('id', '=', visit.id).execute();
      await expect(asApp.updateTable('support_visits').set({ developer_name: 'Someone else' }).where('id', '=', visit.id).execute()).rejects.toThrow(/kept/);
      const action = await asApp.insertInto('support_actions').values({ visit_id: visit.id, method: 'POST', path: '/api/x' }).returning('id').executeTakeFirstOrThrow();
      await asApp.updateTable('support_actions').set({ status: 201 }).where('id', '=', action.id).execute();
      await expect(asApp.updateTable('support_actions').set({ status: 500 }).where('id', '=', action.id).execute()).rejects.toThrow(/kept/);
    });
  });
});

describe('row security for the app role', () => {
  it('ignores app.maintenance unless the owner sets it', async () => {
    const seen = await runAsBusiness(1, () =>
      asApp.transaction().execute(async (trx) => {
        await sql`select set_config('app.maintenance', 'on', true)`.execute(trx);
        return trx.selectFrom('stock_locations').select('business_id').distinct().execute();
      }),
    );
    expect(seen.map((row) => row.business_id)).toEqual([1]);

    const owner = await runAsBusiness(1, () =>
      context.db.transaction().execute(async (trx) => {
        await sql`select set_config('app.maintenance', 'on', true)`.execute(trx);
        return trx.selectFrom('stock_locations').select('business_id').distinct().orderBy('business_id').execute();
      }),
    );
    expect(owner.map((row) => row.business_id)).toEqual([1, otherId]);
  });

  it('reads only the sign-in tables before the business is known', async () => {
    const { locations, settings } = await asApp.transaction().execute(async (trx) => {
      await sql`select set_config('app.business_id', '', true), set_config('app.system', 'on', true)`.execute(trx);
      return {
        locations: await trx.selectFrom('stock_locations').select('id').execute(),
        settings: await trx.selectFrom('settings').select('business_id').distinct().execute(),
      };
    });
    expect(locations).toEqual([]);
    expect(settings.length).toBeGreaterThan(0);
  });
});
