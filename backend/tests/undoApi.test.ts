import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
const tokens = {} as Record<'admin' | 'owner' | 'employee', string>;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  for (const role of ['admin', 'owner', 'employee'] as const) tokens[role] = await loginAs(context, role);
});
afterAll(() => context.db.destroy());

const api = () => request(context.app);
const auth = (role: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[role]}` });

async function entryOf(action: string): Promise<number> {
  const row = await context.db.selectFrom('activity_log').select('id').where('action', '=', action).orderBy('id', 'desc').executeTakeFirstOrThrow();
  return row.id;
}

async function sale(role: keyof typeof tokens, quantity = 2) {
  const productId = await createTestProduct(context, tokens.admin, { price: 50, stock: 10 });
  await api().post('/api/sales').set(auth(role)).send({ productId, quantity });
  return entryOf('sale.recorded');
}

describe('POST /api/activity/:id/undo and /restore', () => {
  it('should undo with a reason, refuse a second undo, and restore', async () => {
    const entryId = await sale('employee');

    const undone = await api().post(`/api/activity/${entryId}/undo`).set(auth('admin')).send({ note: 'wrong product' });
    expect(undone.status).toBe(200);
    expect(undone.body.data.undo).toMatchObject({ state: 'undone', note: 'wrong product' });

    const again = await api().post(`/api/activity/${entryId}/undo`).set(auth('admin')).send({});
    expect(again.status).toBe(409);

    const restored = await api().post(`/api/activity/${entryId}/restore`).set(auth('admin'));
    expect(restored.status).toBe(200);
    expect(restored.body.data.undo.state).toBe('undoable');
  });

  it('should refuse employees, unknown entries and entries that cannot be undone', async () => {
    const entryId = await sale('employee');

    expect((await api().post(`/api/activity/${entryId}/undo`).set(auth('employee')).send({})).status).toBe(403);
    expect((await api().post('/api/activity/999999/undo').set(auth('admin')).send({})).status).toBe(404);
    const signIn = await api().post(`/api/activity/${await entryOf('auth.logged_in')}/undo`).set(auth('admin')).send({});
    expect(signIn.status).toBe(404);
    expect(signIn.body.error?.message ?? signIn.body.message).toMatch(/can't be undone/i);
  });

  it('should refuse a reason over 500 characters', async () => {
    const entryId = await sale('employee');
    const response = await api().post(`/api/activity/${entryId}/undo`).set(auth('admin')).send({ note: 'x'.repeat(501) });
    expect(response.status).toBe(400);
  });
});

describe('GET /api/activity undo state', () => {
  it('should offer an employee sale for undo, with its effect', async () => {
    const entryId = await sale('employee', 2);
    const employee = await context.db.selectFrom('users').select('id').where('role', '=', 'employee').executeTakeFirstOrThrow();

    const response = await api().get('/api/activity').query({ userId: employee.id }).set(auth('admin'));

    const entry = response.body.data.find((item: { id: number }) => item.id === entryId);
    expect(entry.undo).toMatchObject({ state: 'undoable', allowed: true, kind: 'sale' });
    expect(entry.undo.effect.stock.delta).toBe(2);
    expect(entry.undo.effect.money.amount).toBe(-100);
  });

  it('should show the owner’s entries to an admin as not theirs to undo', async () => {
    const entryId = await sale('owner');

    const response = await api().get('/api/activity').set(auth('admin'));

    const entry = response.body.data.find((item: { id: number }) => item.id === entryId);
    expect(entry.undo).toMatchObject({ state: 'forbidden', allowed: false });
  });

  it('should give no undo state to entries that cannot be undone', async () => {
    const response = await api().get('/api/activity').query({ action: 'auth' }).set(auth('admin'));
    expect(response.body.data[0].undo).toBeNull();
  });
});
