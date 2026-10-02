import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestProduct, createTestUser, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

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

// Shop time is Europe/Budapest (UTC+2 in October); the summary hour is 20:00.
const MONDAY_EVENING = new Date('2026-10-05T19:30:00Z');
const MONDAY_NOON = new Date('2026-10-05T10:00:00Z');
const SUNDAY_EVENING = new Date('2026-10-04T19:30:00Z');
const WEEK = 7 * 24 * 60 * 60 * 1000;

const reportsTo = async (to: string) =>
  context.db.selectFrom('email_outbox').select(['subject', 'text']).where('to_address', '=', to).execute();

describe('weekly report email', () => {
  it('should go out on Monday after the summary hour, once a week', async () => {
    const service = context.container.weeklyReportService;

    const sent = [
      await service.sendIfDue(SUNDAY_EVENING),
      await service.sendIfDue(MONDAY_NOON),
      await service.sendIfDue(MONDAY_EVENING),
      await service.sendIfDue(new Date(MONDAY_EVENING.getTime() + 60 * 60 * 1000)),
      await service.sendIfDue(new Date(MONDAY_EVENING.getTime() + WEEK)),
    ];

    expect(sent).toEqual([false, false, true, false, true]);
    expect(await reportsTo('admin@test.local')).toHaveLength(2);
  });

  it("should sum last week's sales and name the best seller", async () => {
    const chair = await createTestProduct(context, adminToken, { name: 'Oak Chair', price: 100, costPrice: 60, stock: 50 });
    await request(context.app)
      .post('/api/sales')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ productId: chair, quantity: 3, saleDate: '2026-09-30T10:00:00Z' });

    await context.container.weeklyReportService.sendIfDue(MONDAY_EVENING);
    const [email] = await reportsTo('admin@test.local');

    expect(email!.subject).toContain('€300.00');
    expect(email!.text).toContain('Oak Chair');
    expect(email!.text).toContain('28 Sept');
  });

  it('should skip people who switched it off, and people who are not admins', async () => {
    await createTestUser(context.db, 'employee');
    const off = await createTestUser(context.db, 'admin', { email: 'quiet@test.local' });
    await context.db.updateTable('users').set({ email_weekly_report: false }).where('id', '=', off.id).execute();

    await context.container.weeklyReportService.sendIfDue(MONDAY_EVENING);

    expect(await reportsTo('admin@test.local')).toHaveLength(1);
    expect(await reportsTo('quiet@test.local')).toHaveLength(0);
    expect(await reportsTo('employee@test.local')).toHaveLength(0);
  });

  it('should let people switch it off from their profile', async () => {
    const response = await request(context.app)
      .put('/api/me/profile')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ emailWeeklyReport: false });

    expect(response.body.data.emailWeeklyReport).toBe(false);
  });
});
