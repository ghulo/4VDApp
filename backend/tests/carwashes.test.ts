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
const OCTOBER = { startDate: '2026-10-01', endDate: '2026-10-31' };

const addCarwash = (body: object, token = adminToken) => request(context.app).post('/api/carwash/places').set(auth(token)).send(body);
const patchCarwash = (id: number, body: object, token = adminToken) =>
  request(context.app).patch(`/api/carwash/places/${id}`).set(auth(token)).send(body);
const places = async (query: object = {}, token = adminToken) =>
  (await request(context.app).get('/api/carwash/places').set(auth(token)).query(query)).body.data as Array<{
    id: number;
    name: string;
    cashFloat: number;
    archived: boolean;
  }>;
const takings = (day: string, body: object, token = adminToken) =>
  request(context.app).put(`/api/carwash/${day}`).set(auth(token)).send(body);

/** A second carwash, "Prishtina", next to the first one that every install starts with. */
async function openSecond() {
  const response = await addCarwash({ name: 'Prishtina', cashFloat: 30 });
  expect(response.status).toBe(201);
  return response.body.data.id as number;
}

describe('carwashes', () => {
  it('should start with one carwash that existing data belongs to', async () => {
    expect(await places()).toEqual([{ id: 1, name: 'Carwash', cashFloat: 0, archived: false }]);
  });

  it('should add, rename and set the float of a carwash, and log it', async () => {
    const id = await openSecond();
    const renamed = await patchCarwash(id, { name: 'Prishtina 2', cashFloat: 45 });

    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({ id, name: 'Prishtina 2', cashFloat: 45, archived: false });
    const log = await context.db.selectFrom('activity_log').select('action').where('entity_type', '=', 'carwash').orderBy('id').execute();
    expect(log.map((entry) => entry.action)).toEqual(['carwash.created', 'carwash.updated']);
  });

  it('should refuse a name that another open carwash has, ignoring capitals', async () => {
    await openSecond();
    expect((await addCarwash({ name: 'prishtina' })).status).toBe(409);
    expect((await patchCarwash(1, { name: 'PRISHTINA' })).status).toBe(409);
    expect((await addCarwash({ name: '   ' })).status).toBe(400);
  });

  it('should keep at least one carwash open, and let an archived name be reused', async () => {
    expect((await patchCarwash(1, { archived: true })).status).toBe(409);
    const id = await openSecond();

    expect((await patchCarwash(1, { archived: true })).status).toBe(200);
    expect((await patchCarwash(id, { archived: true })).status).toBe(409);
    expect((await places()).map((place) => place.name)).toEqual(['Prishtina']);
    // The archived one is still listed for managers, after the open ones.
    expect((await places({ includeArchived: 'true' })).map((place) => [place.name, place.archived])).toEqual([
      ['Prishtina', false],
      ['Carwash', true],
    ]);
    expect((await addCarwash({ name: 'Carwash' })).status).toBe(201);
  });

  it('should only let managers change the list, and show staff the open ones', async () => {
    const employeeToken = await loginAs(context, 'employee');
    const ownerToken = await loginAs(context, 'owner');

    expect((await addCarwash({ name: 'Nope' }, employeeToken)).status).toBe(403);
    expect((await addCarwash({ name: 'Nope' }, ownerToken)).status).toBe(403);
    expect(await places({}, employeeToken)).toHaveLength(1);
  });

  it('should stop a closed carwash adding its monthly expenses', async () => {
    const id = await openSecond();
    await request(context.app).post('/api/expenses').set(auth()).send({ day: '2026-09-05', amount: 200, category: 'rent', place: 'carwash', carwashId: id, repeatMonthly: true });
    await request(context.app).post('/api/expenses').set(auth()).send({ day: '2026-09-05', amount: 900, category: 'rent', place: 'shop', repeatMonthly: true });

    await patchCarwash(id, { archived: true });

    const rules = (await request(context.app).get('/api/expenses/recurring').set(auth())).body.data;
    expect(rules.map((rule: { place: string }) => rule.place)).toEqual(['shop']);
  });
});

describe('takings with several carwashes', () => {
  it('should need to be told which carwash once there are two, but not before', async () => {
    expect((await takings('2026-10-01', { carwash: 10, change: 0 })).status).toBe(200);
    const second = await openSecond();

    const unclear = await takings('2026-10-01', { carwash: 10, change: 0 });
    expect(unclear.status).toBe(400);
    expect(unclear.body.message).toContain('which carwash');
    expect((await takings('2026-10-01', { carwashId: second, carwash: 20, change: 5 })).status).toBe(200);
  });

  it('should keep one entry per carwash and day, and total them together and apart', async () => {
    const second = await openSecond();
    await takings('2026-10-01', { carwashId: 1, carwash: 100, change: 10 });
    await takings('2026-10-01', { carwashId: second, carwash: 60, change: 5 });
    await takings('2026-10-01', { carwashId: second, carwash: 70, change: 5 }); // replaces
    await takings('2026-10-02', { carwashId: 1, carwash: 40, change: 0 });

    const all = (await request(context.app).get('/api/carwash').set(auth()).query(OCTOBER)).body.data;
    expect(all.totals).toEqual({ carwash: 210, change: 15, total: 225, days: 3 });
    expect(all.days.map((day: { carwashName: string; day: string; total: number }) => [day.day, day.carwashName, day.total])).toEqual([
      ['2026-10-02', 'Carwash', 40],
      ['2026-10-01', 'Carwash', 110],
      ['2026-10-01', 'Prishtina', 75],
    ]);
    expect(all.byCarwash.map((row: { name: string; total: number }) => [row.name, row.total])).toEqual([
      ['Carwash', 150],
      ['Prishtina', 75],
    ]);

    const only = (await request(context.app).get('/api/carwash').set(auth()).query({ ...OCTOBER, carwashId: second })).body.data;
    expect(only.totals).toEqual({ carwash: 70, change: 5, total: 75, days: 1 });
    expect(only.days).toHaveLength(1);
  });

  it("should remove just one carwash's day", async () => {
    const second = await openSecond();
    await takings('2026-10-01', { carwashId: 1, carwash: 100, change: 0 });
    await takings('2026-10-01', { carwashId: second, carwash: 60, change: 0 });

    const removed = await request(context.app).delete('/api/carwash/2026-10-01').query({ carwashId: second }).set(auth());

    expect(removed.status).toBe(200);
    const left = (await request(context.app).get('/api/carwash').set(auth()).query(OCTOBER)).body.data.days;
    expect(left.map((day: { carwashName: string }) => day.carwashName)).toEqual(['Carwash']);
  });

  it('should name the carwash in the log only when there are several, and refuse an archived one', async () => {
    await takings('2026-10-01', { carwash: 10, change: 0 });
    const second = await openSecond();
    await takings('2026-10-02', { carwashId: second, carwash: 20, change: 0 });
    await patchCarwash(second, { archived: true });
    const archived = await takings('2026-10-03', { carwashId: second, carwash: 20, change: 0 });

    const summaries = await context.db.selectFrom('activity_log').select('summary').where('action', '=', 'carwash.recorded').orderBy('id').execute();
    expect(summaries[0]!.summary).toContain('the carwash takings for 2026-10-01');
    expect(summaries[1]!.summary).toContain('the Prishtina carwash takings for 2026-10-02');
    expect(archived.status).toBe(409);
  });

  it("should list today's takings for each open carwash", async () => {
    const second = await openSecond();
    await takings(today(), { carwashId: second, carwash: 20, change: 5 });

    const response = await request(context.app).get('/api/carwash/today').set(auth(await loginAs(context, 'employee')));

    expect(response.status).toBe(200);
    expect(response.body.data.carwashes.map((row: { name: string; takings: unknown }) => [row.name, row.takings])).toEqual([
      ['Carwash', null],
      ['Prishtina', { carwash: 20, change: 5 }],
    ]);
  });
});

describe('cash check with several carwashes', () => {
  const count = (body: object, token = adminToken) => request(context.app).post('/api/cash-counts').set(auth(token)).send(body);
  const countsToday = async () =>
    (await request(context.app).get('/api/cash-counts').set(auth()).query({ startDate: today(), endDate: today() })).body.data;

  it("should count each carwash's drawer against its own takings and float", async () => {
    const second = await openSecond(); // float €30
    await takings(today(), { carwashId: 1, carwash: 100, change: 0 });
    await takings(today(), { carwashId: second, carwash: 50, change: 0 });

    await count({ place: 'carwash', carwashId: 1, counted: 100 });
    await count({ place: 'carwash', carwashId: second, counted: 70 }); // 70 − 30 float = 40, expected 50

    const counts = await countsToday();
    expect(counts.map((row: { carwashName: string; expected: number; difference: number }) => [row.carwashName, row.expected, row.difference])).toEqual([
      ['Carwash', 100, 0],
      ['Prishtina', 50, -10],
    ]);
    const alert = await context.db.selectFrom('notifications').select('title').where('type', '=', 'cash_difference').execute();
    expect(alert.map((row) => row.title)).toEqual(['Carwash (Prishtina) cash short by €10.00']);
  });

  it("should show each open carwash's drawer for today, and refuse a vague carwash count", async () => {
    await openSecond();

    const drawers = (await request(context.app).get('/api/cash-counts/today').set(auth())).body.data;
    expect(drawers.map((row: { place: string; name: string | null; float: number }) => [row.place, row.name, row.float])).toEqual([
      ['shop', null, 50],
      ['carwash', 'Carwash', 0],
      ['carwash', 'Prishtina', 30],
    ]);
    expect((await count({ place: 'carwash', counted: 10 })).status).toBe(400);
    expect((await count({ place: 'shop', carwashId: 1, counted: 10 })).status).toBe(400);
  });

  it('should add a line per counted carwash to the daily summary', async () => {
    const second = await openSecond();
    await takings(today(), { carwashId: 1, carwash: 100, change: 0 });
    await count({ place: 'carwash', carwashId: 1, counted: 100 });

    const { message } = await context.container.dailySummaryService.compose(new Date());

    expect(message).toContain('Carwash (Carwash): €100.00 + €0.00 change = €100.00.');
    expect(message).toContain("Today's carwash (Prishtina) takings aren't entered yet.");
    expect(message).toContain('Carwash cash (Carwash) matched.');
    expect(second).toBeGreaterThan(1);
  });
});

describe('expenses, reports and the Monday email with several carwashes', () => {
  it('should file a carwash expense under its carwash', async () => {
    const second = await openSecond();
    const add = (body: object) => request(context.app).post('/api/expenses').set(auth()).send({ day: '2026-10-03', category: 'water', ...body });

    expect((await add({ amount: 10, place: 'carwash' })).status).toBe(400); // two open: which one?
    expect((await add({ amount: 10, place: 'carwash', carwashId: second })).status).toBe(201);
    expect((await add({ amount: 25, place: 'carwash', carwashId: 1 })).status).toBe(201);
    expect((await add({ amount: 5, place: 'shop', carwashId: 1 })).status).toBe(400);

    const { totals } = (await request(context.app).get('/api/expenses').set(auth()).query({ startDate: '2026-10-01T00:00:00+02:00', endDate: '2026-11-01T00:00:00+01:00' })).body.data;
    expect(totals.byPlace.carwash).toBe(35);
    expect(totals.byCarwash).toEqual([
      { carwashId: 1, name: 'Carwash', total: 25 },
      { carwashId: second, name: 'Prishtina', total: 10 },
    ]);
  });

  it('should add the carwashes up in the report summary and split them by carwash', async () => {
    const second = await openSecond();
    await takings('2026-10-03', { carwashId: 1, carwash: 40, change: 10 });
    await takings('2026-10-03', { carwashId: second, carwash: 30, change: 0 });

    const response = await request(context.app).get('/api/reports/summary').set(auth()).query({ startDate: '2026-10-01T00:00:00+02:00', endDate: '2026-11-01T00:00:00+01:00' });

    expect(response.body.data.carwash.current).toMatchObject({ carwash: 70, change: 10, total: 80 });
    expect(response.body.data.carwash.byCarwash.map((row: { name: string; total: number }) => [row.name, row.total])).toEqual([
      ['Carwash', 50],
      ['Prishtina', 30],
    ]);
  });

  it('should say what each carwash made in the weekly report, and add them in the money sheet', async () => {
    const second = await openSecond();
    await takings('2026-09-30', { carwashId: 1, carwash: 40, change: 10 });
    await takings('2026-09-30', { carwashId: second, carwash: 30, change: 0 });

    const report = await context.container.reportDeliveryService.view(1, 'en', 'weekly', '2026-09-28', new Date('2026-10-05T19:30:00Z'));
    expect(report.sections.carwash!.each.map((row) => [row.name, row.total])).toEqual([
      ['Carwash', 50],
      ['Prishtina', 30],
    ]);

    const csv = await request(context.app).get('/api/exports/money.csv').set(auth()).query({ startDate: '2026-09-30', endDate: '2026-09-30' });
    expect(csv.text).toContain('2026-09-30,0,70,10,0,80');
  });
});
