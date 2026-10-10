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

const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });
const checklist = async (token = adminToken) => request(context.app).get('/api/day/today').set(auth(token));

describe('end-of-day checklist', () => {
  it('should start open and close once each item is done', async () => {
    const before = (await checklist()).body.data;
    expect(before.day).toBe(today());
    expect(before.cash.done).toBe(false);
    expect(before.cash.drawers.map((drawer: { place: string }) => drawer.place)).toEqual(['shop', 'carwash']);
    expect(before.carwash).toMatchObject({ done: false, carwashes: [{ name: 'Carwash', entered: false }] });
    expect(before.expenses).toMatchObject({ done: false, count: 0, noneMarked: false });
    expect(before.approvals).toEqual({ done: true, waiting: 0 });
    expect(before.done).toBe(false);

    await request(context.app).post('/api/cash-counts').set(auth()).send({ place: 'shop', counted: 0 });
    await request(context.app).post('/api/cash-counts').set(auth()).send({ place: 'carwash', counted: 0 });
    await request(context.app).put(`/api/carwash/${today()}`).set(auth()).send({ carwash: 40, change: 0 });
    await request(context.app).post('/api/expenses').set(auth()).send({ day: today(), amount: 12.5, category: 'supplies', place: 'shop' });

    const after = (await checklist()).body.data;
    expect(after.cash.done).toBe(true);
    expect(after.carwash.done).toBe(true);
    expect(after.expenses).toMatchObject({ done: true, count: 1, total: 12.5 });
    expect(after.done).toBe(true);
  });

  it('should let a manager say there were no expenses, and take it back', async () => {
    const marked = await request(context.app).put('/api/day/today/no-expenses').set(auth()).send({ none: true });
    expect(marked.status).toBe(200);
    expect(marked.body.data.expenses).toMatchObject({ done: true, noneMarked: true, count: 0 });
    expect(marked.body.data.expenses.noneMarkedBy).toBeTruthy();

    const cleared = await request(context.app).put('/api/day/today/no-expenses').set(auth()).send({ none: false });
    expect(cleared.body.data.expenses).toMatchObject({ done: false, noneMarked: false });
  });

  it('should keep the checklist to the people who run the shop', async () => {
    const employeeToken = await loginAs(context, 'employee');
    const ownerToken = await loginAs(context, 'owner');
    expect((await checklist(employeeToken)).status).toBe(403);
    expect((await checklist(ownerToken)).status).toBe(200);
    expect((await request(context.app).put('/api/day/today/no-expenses').set(auth(ownerToken)).send({ none: true })).status).toBe(403);
  });
});
