import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nextMonthDay } from '../src/services/ExpenseService.js';
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

const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const add = (body: object, token = adminToken) => request(context.app).post('/api/expenses').set(auth(token)).send(body);
/** First to last day, both included, as shop-time midnights (Budapest is UTC+2 in summer), like the dashboard sends. */
const list = async (first: string, last: string) => {
  const dayAfter = new Date(Date.parse(`${last}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const query = { startDate: `${first}T00:00:00+02:00`, endDate: `${dayAfter}T00:00:00+02:00` };
  return (await request(context.app).get('/api/expenses').set(auth()).query(query)).body.data;
};

describe('expenses', () => {
  it('should add up by place and category', async () => {
    expect((await add({ day: '2026-09-03', amount: 300, category: 'rent', place: 'shop' })).status).toBe(201);
    await add({ day: '2026-09-10', amount: 45.5, category: 'electricity', place: 'carwash', note: 'September bill' });
    await add({ day: '2026-09-12', amount: 20, category: 'supplies', place: 'both' });
    await add({ day: '2026-10-01', amount: 999, category: 'rent', place: 'shop' });

    const { expenses, totals } = await list('2026-09-01', '2026-09-30');

    expect(expenses).toHaveLength(3);
    expect(totals.total).toBe(365.5);
    expect(totals.byPlace).toEqual({ shop: 300, carwash: 45.5, both: 20 });
    expect(totals.byCategory.electricity).toBe(45.5);
  });

  it('should repeat monthly from a past start, and not bring back a removed month', async () => {
    const service = context.container.expenseService;
    await add({ day: '2026-07-31', amount: 800, category: 'wages', place: 'both', repeatMonthly: true });
    // Started in July with the 31st: it repeats on the 28th, filling in Aug and Sep up to today.
    await service.fillDue(new Date('2026-09-30T10:00:00Z'));
    let { expenses } = await list('2026-07-01', '2026-09-30');
    expect(expenses.map((expense: { day: string }) => expense.day)).toEqual(['2026-09-28', '2026-08-28', '2026-07-31']);

    await request(context.app).delete(`/api/expenses/${expenses[0].id}`).set(auth());
    expect(await service.fillDue(new Date('2026-09-30T12:00:00Z'))).toBe(0);
    ({ expenses } = await list('2026-07-01', '2026-09-30'));
    expect(expenses).toHaveLength(2);

    const [rule] = (await request(context.app).get('/api/expenses/recurring').set(auth())).body.data;
    await request(context.app).post(`/api/expenses/recurring/${rule.id}/stop`).set(auth());
    expect(await service.fillDue(new Date('2026-12-30T12:00:00Z'))).toBe(0);
    expect((await request(context.app).get('/api/expenses/recurring').set(auth())).body.data).toHaveLength(0);
  });

  it('should take expenses off profit in the report summary', async () => {
    const chair = await createTestProduct(context, adminToken, { name: 'Oak Chair', price: 100, costPrice: 60, stock: 5 });
    await request(context.app).post('/api/sales').set(auth()).send({ productId: chair, quantity: 2, saleDate: '2026-09-05T10:00:00Z' });
    await request(context.app).put('/api/carwash/2026-09-05').set(auth()).send({ carwash: 50, change: 10 });
    await add({ day: '2026-09-06', amount: 70, category: 'rent', place: 'shop' });

    const summary = (await request(context.app).get('/api/reports/summary').set(auth()).query({ startDate: '2026-09-01', endDate: '2026-09-30' })).body.data;

    // Shop profit 80 + carwash 60 − expenses 70.
    expect(summary.expenses.current).toBe(70);
    expect(summary.netProfit.current).toBe(70);
  });

  it('should let only managers add, and refuse future days and zero amounts', async () => {
    const ownerToken = await loginAs(context, 'owner');
    expect((await add({ day: '2026-09-03', amount: 10, category: 'rent', place: 'shop' }, ownerToken)).status).toBe(403);
    expect((await request(context.app).get('/api/expenses').set(auth(ownerToken)).query({ startDate: '2026-09-01', endDate: '2026-09-30' })).status).toBe(200);
    expect((await add({ day: '2999-01-01', amount: 10, category: 'rent', place: 'shop' })).status).toBe(400);
    expect((await add({ day: '2026-09-03', amount: 0, category: 'rent', place: 'shop' })).status).toBe(400);
    expect((await add({ day: '2026-09-03', amount: 10, category: 'stock', place: 'shop' })).status).toBe(400);
  });

  it('should roll monthly days over the year end', () => {
    expect(nextMonthDay('2026-12-15', 15)).toBe('2027-01-15');
    expect(nextMonthDay('2026-01-31', 28)).toBe('2026-02-28');
  });
});
