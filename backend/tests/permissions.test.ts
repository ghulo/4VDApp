import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let developerToken: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const save = (body: object, token = developerToken) => request(context.app).put('/api/permissions').set(auth(token)).send(body);

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  context.container.permissionService.forget();
  developerToken = await loginAs(context, 'developer');
});
afterAll(async () => {
  context.container.permissionService.forget();
  await context.db.destroy();
});

describe('roles and what they may do', () => {
  it('should start from the usual rules, readable by everyone', async () => {
    const employeeToken = await loginAs(context, 'employee');

    const response = await request(context.app).get('/api/permissions').set(auth(employeeToken));

    expect(response.status).toBe(200);
    expect(response.body.data.powers.oversee).toEqual(['developer', 'admin', 'owner']);
    expect(response.body.data.powers).toEqual(response.body.data.defaults);
  });

  it('should let the developer give a role a power, which applies on the next request', async () => {
    const employeeToken = await loginAs(context, 'employee');
    expect((await request(context.app).get('/api/activity').set(auth(employeeToken))).status).toBe(403);

    const saved = await save({ powers: { oversee: ['admin', 'owner', 'employee'] }, pages: {} });

    expect(saved.status).toBe(200);
    expect(saved.body.data.powers.oversee).toEqual(['developer', 'admin', 'owner', 'employee']);
    expect((await request(context.app).get('/api/activity').set(auth(employeeToken))).status).toBe(200);
  });

  it('should take a power away', async () => {
    const ownerToken = await loginAs(context, 'owner');
    const productId = await createTestProduct(context, developerToken);

    await save({ powers: { sell: ['admin', 'employee'] }, pages: {} });

    const response = await request(context.app).post('/api/sales').set(auth(ownerToken)).send({ productId, quantity: 1 });
    expect(response.status).toBe(403);
  });

  it('should keep managing people and settings with the developer and admins', async () => {
    const ownerToken = await loginAs(context, 'owner');

    const saved = await save({ powers: { manage: ['owner'] }, pages: {} });

    expect(saved.body.data.powers.manage).toEqual(['developer', 'admin']);
    expect((await request(context.app).put('/api/settings').set(auth(ownerToken)).send({ returnWindowDays: 3 })).status).toBe(403);
  });

  it('should let only the developer change the rules', async () => {
    const adminToken = await loginAs(context, 'admin');

    const response = await save({ powers: { filing: ['admin'] }, pages: {} }, adminToken);

    expect(response.status).toBe(403);
  });

  it('should keep the menu pages chosen for each role', async () => {
    const saved = await save({ powers: {}, pages: { '/books': ['admin', 'accountant'] } });

    expect(saved.body.data.pages).toEqual({ '/books': ['admin', 'accountant'] });
  });

  it('should log each change and put it back from the history', async () => {
    await save({ powers: { filing: ['admin', 'accountant'] }, pages: {} });

    const history = await request(context.app).get('/api/permissions/history').set(auth(developerToken));
    expect(history.body.data[0].changes).toEqual([{ role: 'owner', power: 'filing', on: false }]);
    const activity = await request(context.app).get('/api/activity').set(auth(developerToken));
    expect(activity.body.data[0].summary).toBe('Changed what roles may do: owner may no longer file VAT');

    const restored = await request(context.app).post(`/api/permissions/history/${history.body.data[0].id}/restore`).set(auth(developerToken));

    expect(restored.status).toBe(200);
    expect(restored.body.data.powers.filing).toEqual(['developer', 'admin', 'owner', 'accountant']);
  });

  it('should read the saved rules again after a restart', async () => {
    await save({ powers: { reopen: ['accountant'] }, pages: {} });
    context.container.permissionService.forget();

    const response = await request(context.app).get('/api/permissions').set(auth(developerToken));

    expect(response.body.data.powers.reopen).toEqual(['developer', 'accountant']);
  });
});
