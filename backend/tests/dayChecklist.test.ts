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
const checklist = async (token = adminToken, query = '') => request(context.app).get(`/api/day${query}`).set(auth(token));
const step = (day: { steps: Array<{ key: string }> }, key: string) => day.steps.find((entry) => entry.key === key) as Record<string, unknown>;

describe('end-of-day checklist', () => {
  it('should start open and close once each item is done', async () => {
    const before = (await checklist()).body.data;
    expect(before.day).toBe(today());
    expect(before.steps.map((entry: { kind: string }) => entry.kind)).toEqual(['drawer', 'drawer', 'carwash', 'expenses', 'requests']);
    expect(step(before, 'shop')).toMatchObject({ done: false });
    expect(before.steps[2]).toMatchObject({ kind: 'carwash', name: 'Carwash', done: false });
    expect(step(before, 'expenses')).toMatchObject({ done: false, count: 0, noneMarked: false });
    expect(step(before, 'requests')).toMatchObject({ done: true, waiting: 0 });
    expect(before).toMatchObject({ done: 1, total: 5, allDone: false });

    await request(context.app).post('/api/cash-counts').set(auth()).send({ place: 'shop', counted: 0 });
    await request(context.app).post('/api/cash-counts').set(auth()).send({ place: 'carwash', counted: 0 });
    await request(context.app).put(`/api/carwash/${today()}`).set(auth()).send({ carwash: 40, change: 0 });
    await request(context.app).post('/api/expenses').set(auth()).send({ day: today(), amount: 12.5, category: 'supplies', place: 'shop' });

    const after = (await checklist()).body.data;
    expect(step(after, 'expenses')).toMatchObject({ done: true, count: 1, total: 12.5 });
    expect(after.allDone).toBe(true);
    expect(after.details.expenses).toHaveLength(1);
    expect(after.details.counts).toHaveLength(2);
    expect(after.details.carwash[0].takings).toEqual({ carwash: 40, change: 0 });
  });

  it('should let a manager say there were no expenses, and take it back', async () => {
    const marked = await request(context.app).put('/api/day/no-expenses').set(auth()).send({ none: true });
    expect(marked.status).toBe(200);
    expect(step(marked.body.data, 'expenses')).toMatchObject({ done: true, noneMarked: true, count: 0 });
    expect(step(marked.body.data, 'expenses').noneMarkedBy).toBeTruthy();

    const cleared = await request(context.app).put('/api/day/no-expenses').set(auth()).send({ none: false });
    expect(step(cleared.body.data, 'expenses')).toMatchObject({ done: false, noneMarked: false });
  });

  it('should show a past day, and only today to the counter', async () => {
    const past = (await checklist(adminToken, '?date=2026-01-05')).body.data;
    expect(past.day).toBe('2026-01-05');
    // Requests are about now, so a past day has no requests step.
    expect(past.steps.some((entry: { kind: string }) => entry.kind === 'requests')).toBe(false);
    expect((await checklist(adminToken, '?date=2999-01-01')).status).toBe(400);
    expect((await checklist(adminToken, '?date=yesterday')).status).toBe(400);
  });

  it('should give the counter only its own steps, for today', async () => {
    const employeeToken = await loginAs(context, 'employee');
    const ownerToken = await loginAs(context, 'owner');
    const shift = (await checklist(employeeToken, '?date=2026-01-05')).body.data;
    expect(shift.day).toBe(today());
    expect(shift.steps.map((entry: { kind: string }) => entry.kind)).toEqual(['drawer', 'drawer', 'carwash']);
    expect(shift.details).toBeNull();
    expect((await checklist(ownerToken)).status).toBe(200);
    expect((await request(context.app).put('/api/day/no-expenses').set(auth(ownerToken)).send({ none: true })).status).toBe(403);
  });
});
