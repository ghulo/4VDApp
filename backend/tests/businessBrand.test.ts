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
    expect(log.details).toMatchObject({ fields: expect.arrayContaining([expect.objectContaining({ field: 'colours' })]) });
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

describe('accent, gradient, back to previous and reset', () => {
  it('saves an accent and the gradient, and keeps the colours they replace', async () => {
    await becomeCustomer();
    await api().put('/api/business').set(auth(adminToken)).send({ brandColour: '#1d5fd1' });
    const response = await api().put('/api/business').set(auth(adminToken)).send({ brandAccent: '#14284B', brandGradient: true });

    expect(response.body.data.brand).toMatchObject({ colour: '#1d5fd1', accent: '#14284b', gradient: true });
    expect(response.body.data.brandPrevious).toEqual({ colour: '#1d5fd1', accent: null, gradient: false, greys: null });
  });

  it('keeps the previous colours when only the name changes', async () => {
    await becomeCustomer();
    await api().put('/api/business').set(auth(adminToken)).send({ brandColour: '#1d5fd1' });
    const response = await api().put('/api/business').set(auth(adminToken)).send({ displayName: 'Kafe D' });

    expect(response.body.data.brandPrevious).toEqual({ colour: null, accent: null, gradient: false, greys: null });
  });

  it('goes back to the starting colours on reset, and logs one colours change per save', async () => {
    await becomeCustomer();
    await api().put('/api/business').set(auth(adminToken)).send({ brandColour: '#1d5fd1', brandAccent: '#e0a33a', brandGradient: true, brandGreys: 'plain' });
    const response = await api().put('/api/business').set(auth(adminToken)).send({ brandColour: null, brandAccent: null, brandGradient: false, brandGreys: null });
    const logs = await context.db.selectFrom('activity_log').select('details').where('action', '=', 'business.updated').execute();

    expect(response.body.data).toMatchObject({ brandColour: null, brandAccent: null, brandGradient: false, brandGreys: null });
    expect(response.body.data.brand).toMatchObject({ colour: response.body.data.brandDefault.colour, greys: 'tinted', accent: null, gradient: false });
    expect(logs).toHaveLength(2);
  });

  it("lets 4VD's own business change its colours, starting from amber", async () => {
    await sql`UPDATE businesses SET short_name = '4vd'`.execute(context.db);
    const before = await api().get('/api/business').set(auth(adminToken));
    const response = await api().put('/api/business').set(auth(adminToken)).send({ brandAccent: '#3fbf8f' });

    expect(before.body.data.brandDefault).toEqual({ colour: '#f5b71a', greys: 'plain' });
    expect(response.body.data.brand).toMatchObject({ house: true, colour: '#f5b71a', accent: '#3fbf8f', logoUrl: null });
  });

  it('refuses an accent that is not a colour code', async () => {
    expect((await api().put('/api/business').set(auth(adminToken)).send({ brandAccent: 'url(x)' })).status).toBe(400);
  });
});

describe('a business look by its link', () => {
  it('shows only the name, logo and colours to anyone, without signing in', async () => {
    await becomeCustomer();
    await api().put('/api/business').set(auth(adminToken)).send({ displayName: 'Kafe D', brandColour: '#7c3a8f' });
    const response = await api().get('/api/brand/kafe-dardania');

    expect(response.status).toBe(200);
    expect(Object.keys(response.body.data).sort()).toEqual(['accent', 'colour', 'gradient', 'greys', 'house', 'initials', 'logoUrl', 'name']);
    expect(response.body.data).toMatchObject({ name: 'Kafe D', colour: '#7c3a8f', house: false });
  });

  it('answers 404 for a link no business uses, and 400 for a malformed one', async () => {
    expect((await api().get('/api/brand/nobody-here')).status).toBe(404);
    expect((await api().get('/api/brand/..%2Fadmin')).status).toBe(400);
  });
});

describe('what the business has set up', () => {
  it('says whether the business has a carwash and TREFIN history, so screens hide what it does not use', async () => {
    await becomeCustomer();
    const withCarwash = await api().get('/api/business').set(auth(employeeToken));
    expect(withCarwash.body.data).toMatchObject({ hasCarwash: true, hasTrefin: false });

    await sql`UPDATE carwashes SET archived_at = now()`.execute(context.db);
    const without = await api().get('/api/business').set(auth(employeeToken));
    expect(without.body.data.hasCarwash).toBe(false);

    await sql`INSERT INTO trefin_stock_documents (trefin_ref, kind, dated, source) VALUES ('d1', 'opening', '2026-01-01', 'test')`.execute(context.db);
    const imported = await api().get('/api/business').set(auth(employeeToken));
    expect(imported.body.data.hasTrefin).toBe(true);
  });

  it("shows the TREFIN parts to 4VD's own business, where TREFIN was used", async () => {
    await sql`UPDATE businesses SET short_name = '4vd'`.execute(context.db);
    const response = await api().get('/api/business').set(auth(employeeToken));
    expect(response.body.data.hasTrefin).toBe(true);
  });
});
