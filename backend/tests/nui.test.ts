import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

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

const auth = () => ({ Authorization: `Bearer ${adminToken}` });

describe('NUI', () => {
  it('should ask a business on a tab for its 9-digit NUI, and give a person none', async () => {
    const missing = await request(context.app).post('/api/customers').set(auth()).send({ name: 'Ndërtimi SH.P.K.', kind: 'business' });
    expect(missing.status).toBe(400);
    const short = await request(context.app).post('/api/customers').set(auth()).send({ name: 'Ndërtimi SH.P.K.', kind: 'business', nui: '1234' });
    expect(short.status).toBe(400);

    const business = await request(context.app).post('/api/customers').set(auth()).send({ name: 'Ndërtimi SH.P.K.', kind: 'business', nui: '811 234 567' });
    expect(business.status).toBe(201);
    expect(business.body.data).toMatchObject({ kind: 'business', nui: '811234567' });

    const person = await request(context.app).post('/api/customers').set(auth()).send({ name: 'Arben', nui: '811234567' });
    expect(person.body.data).toMatchObject({ kind: 'person', nui: null });
  });

  it('should require a supplier NUI and let a manager add one to an old supplier', async () => {
    expect((await request(context.app).post('/api/suppliers').set(auth()).send({ name: 'Fresh Foods' })).status).toBe(400);
    const id = (await request(context.app).post('/api/suppliers').set(auth()).send({ name: 'Fresh Foods', nui: '811234567' })).body.data.id;

    const updated = await request(context.app).put(`/api/suppliers/${id}`).set(auth()).send({ name: 'Fresh Foods', nui: '819999999', phone: '044 000 111' });
    expect(updated.body.data).toMatchObject({ nui: '819999999', phone: '044 000 111' });
  });

  it("should keep the shop's NUI and count it in the shop details launch step", async () => {
    const developer = { Authorization: `Bearer ${await loginAs(context, 'developer')}` };
    const shopDetails = async () =>
      ((await request(context.app).get('/api/settings/launch-checklist').set(developer)).body.data as Array<{ key: string; done: boolean }>).find(
        (step) => step.key === 'shopDetails',
      )!.done;
    await request(context.app).put('/api/business').set(auth()).send({ address: 'Rr. Fehmi Agani', phone: '044 123 456' });
    expect(await shopDetails()).toBe(false);

    const saved = await request(context.app).put('/api/business').set(auth()).send({ nui: '810000001' });
    expect(saved.body.data.nui).toBe('810000001');
    expect(await shopDetails()).toBe(true);
  });
});
