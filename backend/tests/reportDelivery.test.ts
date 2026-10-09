import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestProduct, createTestUser, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let adminId: number;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
  adminId = (await context.db.selectFrom('users').select('id').where('email', '=', 'admin@test.local').executeTakeFirstOrThrow()).id;
});
afterAll(() => context.db.destroy());

const api = () => request(context.app);
const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const service = () => context.container.reportDeliveryService;
const reportsOf = (type: string) =>
  context.db.selectFrom('notifications').select(['user_id', 'title', 'message', 'link']).where('type', '=', type).execute();

// Budapest is UTC+2 in early October. Friday 9 Oct 2026 and Monday 5 Oct 2026.
const FRIDAY_MORNING = new Date('2026-10-09T06:00:00Z');
const FRIDAY_NIGHT = new Date('2026-10-09T19:30:00Z');
const MONDAY_MORNING = new Date('2026-10-05T07:00:00Z');

describe('the full report', () => {
  it('should bring every part of the business together', async () => {
    const chair = await createTestProduct(context, adminToken, { name: 'Chair', price: 100, costPrice: 60, stock: 50 });
    await api().post('/api/sales').set(auth()).send({ productId: chair, quantity: 2 });

    const report = (await api().get('/api/reports/full?kind=daily').set(auth())).body.data;
    expect(report).toMatchObject({ kind: 'daily', partial: true });
    expect(report.from).toBe(report.to);
    expect(report.sections.sales).toMatchObject({ revenue: 200, profit: 80, salesCount: 1, unitsSold: 2 });
    expect(report.sections.products[0]).toMatchObject({ name: 'Chair', unitsSold: 2, revenue: 200 });
    expect(report.sections.team[0]).toMatchObject({ name: 'Test admin', salesCount: 1 });
    expect(Object.keys(report.sections)).toEqual(['sales', 'products', 'team', 'losses', 'carwash', 'cash', 'expenses', 'tabs', 'bills', 'stock', 'approvals']);
  });

  it('should cover seven days with each day’s sales for the weekly one', async () => {
    const report = (await api().get('/api/reports/full?kind=weekly&from=2026-09-28').set(auth())).body.data;
    expect(report).toMatchObject({ from: '2026-09-28', to: '2026-10-04', previousFrom: '2026-09-21', partial: false });
    expect(report.sections.sales.byDay).toHaveLength(7);
  });

  it('should keep reports to the people who run the shop', async () => {
    const employee = await loginAs(context, 'employee');
    expect((await api().get('/api/reports/full').set(auth(employee))).status).toBe(403);
    expect((await api().get('/api/reports/settings').set(auth(employee))).status).toBe(403);
  });
});

describe('report settings', () => {
  it('should start with everything on and keep each person’s own choices', async () => {
    const before = (await api().get('/api/reports/settings').set(auth())).body.data;
    expect(before).toMatchObject({ daily: { enabled: true }, weekly: { enabled: true, day: 1 }, email: false });
    expect(before.sections).toHaveLength(11);

    const saved = await api()
      .put('/api/reports/settings')
      .set(auth())
      .send({ daily: { enabled: true, hour: 22 }, weekly: { enabled: false, day: 5, hour: 9 }, sections: ['bills', 'sales'], email: true });
    expect(saved.body.data).toMatchObject({ daily: { hour: 22 }, weekly: { enabled: false, day: 5 }, sections: ['sales', 'bills'], email: true });

    const report = (await api().get('/api/reports/full').set(auth())).body.data;
    expect(Object.keys(report.sections)).toEqual(['sales', 'bills']);
  });

  it('should refuse a report with nothing in it', async () => {
    const response = await api()
      .put('/api/reports/settings')
      .set(auth())
      .send({ daily: { enabled: true, hour: 21 }, weekly: { enabled: true, day: 1, hour: 8 }, sections: [], email: false });
    expect(response.status).toBe(400);
  });
});

describe('sending reports', () => {
  it('should send the daily report once, after each person’s own hour, with a link to it', async () => {
    const owner = await createTestUser(context.db, 'owner');
    await context.db.insertInto('report_subscriptions').values({ user_id: owner.id, daily_hour: 23 }).execute();

    expect(await service().sendDue(FRIDAY_MORNING)).toBe(0);
    expect(await service().sendDue(FRIDAY_NIGHT)).toBe(1); // only the admin; the owner wants it at 23:00
    expect(await service().sendDue(new Date(FRIDAY_NIGHT.getTime() + 60_000))).toBe(0);

    const [sent] = await reportsOf('daily_report');
    expect(sent).toMatchObject({ user_id: adminId, link: '/report?kind=daily&from=2026-10-09' });
    expect(sent!.title).toMatch(/^Daily report · 9 Oct/);
  });

  it('should send the weekly report on the chosen day, covering the 7 days before', async () => {
    await service().sendDue(MONDAY_MORNING);
    const [weekly] = await reportsOf('weekly_report');
    expect(weekly!.link).toBe('/report?kind=weekly&from=2026-09-28');
    expect(await service().sendDue(new Date('2026-10-06T07:00:00Z'))).toBe(0);
  });

  it('should send nothing to someone who switched both off', async () => {
    await context.db.insertInto('report_subscriptions').values({ user_id: adminId, daily_enabled: false, weekly_enabled: false }).execute();
    expect(await service().sendDue(MONDAY_MORNING)).toBe(0);
  });

  it('should send a test right away and leave the schedule alone', async () => {
    const response = await api().post('/api/reports/send-test').set(auth()).send({ kind: 'weekly' });
    expect(response.status).toBe(200);
    const [test] = await reportsOf('weekly_report');
    expect(test!.title).toMatch(/^Test: Weekly report/);

    const row = await context.db.selectFrom('report_subscriptions').select('last_weekly').where('user_id', '=', adminId).executeTakeFirst();
    expect(row?.last_weekly ?? null).toBeNull();
  });

  it('should push reports even when the summary topic is off', async () => {
    await context.db.updateTable('users').set({ push_preferences: { summary: false } }).execute();
    await context.db
      .insertInto('push_subscriptions')
      .values({ user_id: adminId, kind: 'expo', token: 'ExponentPushToken[abc]' })
      .execute();
    await api().post('/api/reports/send-test').set(auth()).send({ kind: 'daily' });
    expect(await context.container.pushService.sendPending()).toBe(1);
  });

  it('should email it to those who asked, with only the chosen sections', async () => {
    await context.db.insertInto('report_subscriptions').values({ user_id: adminId, email: true, sections: ['sales', 'bills'] }).execute();
    await service().sendDue(FRIDAY_NIGHT);
    const [email] = await context.db.selectFrom('email_outbox').select(['subject', 'text']).execute();
    expect(email!.subject).toMatch(/^Daily report/);
    expect(email!.text).toContain('Supplier bills');
    expect(email!.text).not.toContain('Best sellers');
    expect(email!.text).toContain('/report?kind=daily&from=2026-10-09');
  });
});
