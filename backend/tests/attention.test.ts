import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TodoItem } from '../src/services/AttentionService.js';
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
const attention = async (token = adminToken) => (await request(context.app).get('/api/attention').set(auth(token))).body.data;
const cashItems = (data: { todo: TodoItem[] }) => data.todo.filter((item) => item.kind === 'cash_difference');

describe('what needs attention', () => {
  it('should list a cash difference until someone checks it, and again after a recount', async () => {
    // Nothing was sold, so anything above the float is a difference.
    await request(context.app).post('/api/cash-counts').set(auth()).send({ place: 'shop', counted: 500, float: 150 });
    const before = await attention();
    const item = cashItems(before)[0]!;
    expect(item).toMatchObject({ severity: 'check', verb: 'markChecked' });
    expect(item.to).toMatch(/^\/day\?date=\d{4}-\d{2}-\d{2}$/);
    expect(before.count).toBeGreaterThanOrEqual(1);

    const checked = await request(context.app).post(`/api/cash-counts/${item.cashCountId}/check`).set(auth());
    expect(checked.status).toBe(200);
    const after = await attention();
    expect(cashItems(after)).toHaveLength(0);
    expect(after.count).toBe(before.count - 1);

    // Counting the drawer again is a new answer, so it needs looking at again.
    await request(context.app).post('/api/cash-counts').set(auth()).send({ place: 'shop', counted: 400, float: 150 });
    expect(cashItems(await attention())).toHaveLength(1);
  });

  it('should keep the shop-wide list to the people who oversee it', async () => {
    await request(context.app).post('/api/cash-counts').set(auth()).send({ place: 'shop', counted: 500, float: 150 });
    const employeeToken = await loginAs(context, 'employee');
    const employee = await attention(employeeToken);
    expect(cashItems(employee)).toHaveLength(0);
    expect(employee.todo.every((item: { kind: string }) => item.kind === 'end_shift')).toBe(true);

    const id = cashItems(await attention())[0]!.cashCountId;
    const staffCheck = await request(context.app).post(`/api/cash-counts/${id}/check`).set(auth(employeeToken));
    expect(staffCheck.status).toBe(403);
    expect((await request(context.app).post('/api/cash-counts/999999/check').set(auth())).status).toBe(404);
  });
});
