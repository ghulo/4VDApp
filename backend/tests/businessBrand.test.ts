import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { BRAND_PRESETS } from '../src/utils/brandColours.js';
import { loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let employeeToken: string;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
  employeeToken = await loginAs(context, 'employee');
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);
/** The test shop as a customer's business, not 4VD's own. */
const becomeCustomer = (shortName = 'kafe-dardania') => sql`UPDATE businesses SET short_name = ${shortName}`.execute(context.db);

describe('business look', () => {
  it("keeps 4VD's own look for 4VD's own business", async () => {
    await sql`UPDATE businesses SET short_name = '4vd'`.execute(context.db);
    const response = await api().get('/api/business').set(auth(employeeToken));

    expect(response.status).toBe(200);
    expect(response.body.data.brand).toMatchObject({ house: true, colour: '#f5b71a', logoUrl: null });
  });

  it('gives a customer business a preset colour and its initials until it picks its own', async () => {
    await becomeCustomer();
    await sql`UPDATE businesses SET name = 'Kafe Dardania SH.P.K.'`.execute(context.db);
    const response = await api().get('/api/business').set(auth(employeeToken));

    expect(response.body.data.brand.house).toBe(false);
    expect(BRAND_PRESETS).toContain(response.body.data.brand.colour);
    expect(response.body.data.brand.initials).toBe('KD');
    expect(response.body.data.brandColour).toBeNull();
  });

  it('saves the name shown, colour, greys and receipt lines, and logs them', async () => {
    await becomeCustomer();
    const response = await api()
      .put('/api/business')
      .set(auth(adminToken))
      .send({ displayName: 'Kafe D', brandColour: '#1D5FD1', brandGreys: 'plain', receiptHeader: 'Rr. Nëna Terezë 14' });
    const log = await context.db.selectFrom('activity_log').select('details').where('action', '=', 'business.updated').executeTakeFirstOrThrow();

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ displayName: 'Kafe D', brandColour: '#1d5fd1', brandGreys: 'plain', receiptHeader: 'Rr. Nëna Terezë 14' });
    expect(response.body.data.brand).toMatchObject({ name: 'Kafe D', colour: '#1d5fd1', greys: 'plain', initials: 'KD' });
    expect(JSON.stringify(log.details)).toContain('brandColour');
  });

  it('refuses a colour that is not a colour code, and staff without the manage power', async () => {
    const wrong = await api().put('/api/business').set(auth(adminToken)).send({ brandColour: 'red; background: url(x)' });
    const staff = await api().put('/api/business').set(auth(employeeToken)).send({ brandColour: '#1d5fd1' });

    expect(wrong.status).toBe(400);
    expect(staff.status).toBe(403);
  });

  it('goes back to the default colour and the legal name when cleared', async () => {
    await becomeCustomer();
    await api().put('/api/business').set(auth(adminToken)).send({ displayName: 'Kafe D', brandColour: '#1d5fd1' });
    const response = await api().put('/api/business').set(auth(adminToken)).send({ displayName: '', brandColour: null });

    expect(response.body.data.displayName).toBeNull();
    expect(response.body.data.brand.name).toBe(response.body.data.name);
    expect(BRAND_PRESETS).toContain(response.body.data.brand.colour);
  });
});

describe('a business look by its link', () => {
  it('shows only the name, logo and colours to anyone, without signing in', async () => {
    await becomeCustomer();
    await api().put('/api/business').set(auth(adminToken)).send({ displayName: 'Kafe D', brandColour: '#7c3a8f' });
    const response = await api().get('/api/brand/kafe-dardania');

    expect(response.status).toBe(200);
    expect(Object.keys(response.body.data).sort()).toEqual(['colour', 'greys', 'house', 'initials', 'logoUrl', 'name']);
    expect(response.body.data).toMatchObject({ name: 'Kafe D', colour: '#7c3a8f', house: false });
  });

  it('answers 404 for a link no business uses, and 400 for a malformed one', async () => {
    expect((await api().get('/api/brand/nobody-here')).status).toBe(404);
    expect((await api().get('/api/brand/..%2Fadmin')).status).toBe(400);
  });
});
