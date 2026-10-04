import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

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

const save = (day: string, body: object, token = adminToken) =>
  request(context.app).put(`/api/carwash/${day}`).set({ Authorization: `Bearer ${token}` }).send(body);
const list = (query: object, token = adminToken) =>
  request(context.app).get('/api/carwash').set({ Authorization: `Bearer ${token}` }).query(query);

// Shop time is Europe/Budapest (UTC+2 in October).
const OCTOBER = { startDate: '2026-10-01', endDate: '2026-10-31' };

describe('carwash takings', () => {
  it('should add up the carwash and the change, one entry per day', async () => {
    expect((await save('2026-10-01', { carwash: 120, change: 30.5 })).status).toBe(200);
    await save('2026-10-02', { carwash: 80, change: 20 });
    // Entering a day again replaces it.
    await save('2026-10-02', { carwash: 90, change: 10 });
    await save('2026-11-01', { carwash: 500, change: 0 });

    const response = await list(OCTOBER);

    expect(response.status).toBe(200);
    expect(response.body.data.totals).toEqual({ carwash: 210, change: 40.5, total: 250.5, days: 2 });
    expect(response.body.data.days.map((day: { day: string; total: number }) => [day.day, day.total])).toEqual([
      ['2026-10-02', 100],
      ['2026-10-01', 150.5],
    ]);
  });

  it('should log who entered and changed it, and let it be removed', async () => {
    await save('2026-10-01', { carwash: 120, change: 30 });
    await save('2026-10-01', { carwash: 100, change: 30 });
    const removed = await request(context.app).delete('/api/carwash/2026-10-01').set({ Authorization: `Bearer ${adminToken}` });

    expect(removed.status).toBe(200);
    expect((await list(OCTOBER)).body.data.days).toHaveLength(0);
    const log = await context.db.selectFrom('activity_log').select(['action', 'summary']).where('entity_type', '=', 'carwash').orderBy('id').execute();
    expect(log.map((entry) => entry.action)).toEqual(['carwash.recorded', 'carwash.recorded', 'carwash.removed']);
    expect(log[1]!.summary).toContain('Changed');
  });

  it('should refuse future days, made-up days and negative amounts', async () => {
    expect((await save('2999-01-01', { carwash: 10, change: 0 })).status).toBe(400);
    expect((await save('2026-02-31', { carwash: 10, change: 0 })).status).toBe(400);
    expect((await save('2026-10-01', { carwash: -5, change: 0 })).status).toBe(400);
    expect((await save('2026-10-01', { carwash: 5 })).status).toBe(400);
  });

  it('should let the owner see it but only managers enter it', async () => {
    const ownerToken = await loginAs(context, 'owner');
    const employeeToken = await loginAs(context, 'employee');

    expect((await list(OCTOBER, ownerToken)).status).toBe(200);
    expect((await save('2026-10-01', { carwash: 10, change: 0 }, ownerToken)).status).toBe(403);
    expect((await list(OCTOBER, employeeToken)).status).toBe(403);
  });

  it('should sit beside the shop in the report summary, not inside its revenue', async () => {
    const chair = await createTestProduct(context, adminToken, { name: 'Oak Chair', price: 100, costPrice: 60, stock: 5 });
    await request(context.app)
      .post('/api/sales')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ productId: chair, quantity: 1, saleDate: '2026-10-03T10:00:00Z' });
    await save('2026-10-03', { carwash: 40, change: 10 });

    const response = await request(context.app)
      .get('/api/reports/summary')
      .set({ Authorization: `Bearer ${adminToken}` })
      .query(OCTOBER);

    expect(response.body.data.current.revenue).toBe(100);
    expect(response.body.data.carwash.current).toEqual({ carwash: 40, change: 10, total: 50, days: 1 });
  });

  it("should be in the owner's daily summary, or say it's missing", async () => {
    const evening = new Date('2026-10-03T18:00:00Z');
    const before = await context.container.dailySummaryService.compose(evening);
    await save('2026-10-03', { carwash: 40, change: 10 });
    const after = await context.container.dailySummaryService.compose(evening);

    expect(before.message).toContain("carwash takings aren't entered yet");
    expect(after.message).toContain('Carwash: €40.00 + €10.00 change = €50.00.');
  });

  it('should be in the Monday email, with the shop and carwash together', async () => {
    const chair = await createTestProduct(context, adminToken, { name: 'Oak Chair', price: 100, costPrice: 60, stock: 5 });
    await request(context.app)
      .post('/api/sales')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ productId: chair, quantity: 1, saleDate: '2026-09-30T10:00:00Z' });
    await save('2026-09-29', { carwash: 40, change: 10 });
    await save('2026-10-04', { carwash: 60, change: 0 });

    await context.container.weeklyReportService.sendIfDue(new Date('2026-10-05T19:30:00Z'));
    const [email] = await context.db.selectFrom('email_outbox').select(['text']).execute();

    expect(email!.text).toContain('Carwash: €110.00 (€100.00 carwash + €10.00 change). Shop and carwash together: €210.00.');
  });
});
