import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

describe('settings', () => {
  it('should start with the default limits', async () => {
    const response = await request(context.app).get('/api/settings').set(auth(employeeToken));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ refundApprovalLimit: 50, returnWindowDays: 14, minimumMarginPercent: 0, dailySummaryHour: 20 });
  });

  it('should let the admin change a limit and log it', async () => {
    const response = await request(context.app).put('/api/settings').set(auth(adminToken)).send({ refundApprovalLimit: 80 });
    const log = await context.db.selectFrom('activity_log').selectAll().where('action', '=', 'settings.updated').execute();

    expect(response.body.data).toEqual({ refundApprovalLimit: 80, returnWindowDays: 14, minimumMarginPercent: 0, dailySummaryHour: 20 });
    expect(log).toHaveLength(1);
  });

  it('should not let employees change limits', async () => {
    const response = await request(context.app).put('/api/settings').set(auth(employeeToken)).send({ returnWindowDays: 99 });

    expect(response.status).toBe(403);
  });

  it('should reject nonsense values', async () => {
    const negative = await request(context.app).put('/api/settings').set(auth(adminToken)).send({ returnWindowDays: -1 });
    const empty = await request(context.app).put('/api/settings').set(auth(adminToken)).send({});

    expect(negative.status).toBe(400);
    expect(empty.status).toBe(400);
  });
});
