import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { UserRole } from '../src/database/types.js';
import { toPublicUser } from '../src/services/mappers.js';
import type { PublicUser } from '../src/types/auth.js';
import { createTestProduct, loginAs, resetData, setupTestApp, stockOf, type TestContext } from './helpers/testApp.js';

let context: TestContext;
const tokens = {} as Record<'developer' | 'admin' | 'owner' | 'employee', string>;
const people = {} as Record<'developer' | 'admin' | 'owner' | 'employee', PublicUser>;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  for (const role of ['developer', 'admin', 'owner', 'employee'] as const) {
    tokens[role] = await loginAs(context, role);
    const row = await context.db.selectFrom('users').selectAll().where('role', '=', role as UserRole).executeTakeFirstOrThrow();
    people[role] = toPublicUser(row);
  }
});
afterAll(() => context.db.destroy());

const api = () => request(context.app);
const auth = (role: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[role]}` });
const undoService = () => context.container.undoService;

/** The newest activity entry with this action. */
async function entryOf(action: string): Promise<number> {
  const row = await context.db
    .selectFrom('activity_log')
    .select('id')
    .where('action', '=', action)
    .orderBy('id', 'desc')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function revenueToday(): Promise<number> {
  const range = { startDate: new Date(Date.now() - 86_400_000).toISOString(), endDate: new Date(Date.now() + 60_000).toISOString() };
  const summary = await api().get('/api/reports/summary').query(range).set(auth('admin'));
  return summary.body.data.current.revenue;
}

async function employeeSale(quantity = 3, stock = 10) {
  const productId = await createTestProduct(context, tokens.admin, { price: 50, stock });
  const sale = await api().post('/api/sales').set(auth('employee')).send({ productId, quantity });
  return { productId, saleId: sale.body.data.id as number, entryId: await entryOf('sale.recorded') };
}

describe('undoing a sale', () => {
  it('should put the stock back, take the money off and tell the employee why', async () => {
    const { productId, saleId, entryId } = await employeeSale(3);

    await undoService().undo(entryId, people.admin, 'typed 3 instead of 2');

    expect(await stockOf(context, productId)).toBe(10);
    expect(await revenueToday()).toBe(0);
    const row = await context.db.selectFrom('sales').select(['undone_at', 'undone_by', 'undo_note']).where('id', '=', saleId).executeTakeFirstOrThrow();
    expect(row.undone_at).not.toBeNull();
    expect(row.undone_by).toBe(people.admin.id);
    expect(row.undo_note).toBe('typed 3 instead of 2');
    const alert = await context.db
      .selectFrom('notifications')
      .select('message')
      .where('user_id', '=', people.employee.id)
      .where('type', '=', 'undone')
      .executeTakeFirstOrThrow();
    expect(alert.message).toContain('typed 3 instead of 2');
    const logged = await context.db.selectFrom('activity_log').select(['user_id', 'entity_id']).where('action', '=', 'undo.applied').executeTakeFirstOrThrow();
    expect(logged).toEqual({ user_id: people.admin.id, entity_id: entryId });
  });

  it('should restore it: the stock leaves again and the money counts again', async () => {
    const { productId, entryId } = await employeeSale(3);
    await undoService().undo(entryId, people.admin, null);

    await undoService().restore(entryId, people.admin);

    expect(await stockOf(context, productId)).toBe(7);
    expect(await revenueToday()).toBe(150);
    expect(await entryOf('undo.restored')).toBeGreaterThan(0);
  });

  it('should refuse to undo the same sale twice, even at the same moment', async () => {
    const { entryId } = await employeeSale(3);

    const results = await Promise.allSettled([
      undoService().undo(entryId, people.admin, null),
      undoService().undo(entryId, people.developer, null),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await expect(undoService().undo(entryId, people.admin, null)).rejects.toThrow(/already undone/i);
  });

  it('should ask for the return to be undone first when one is waiting or approved', async () => {
    const { saleId, entryId } = await employeeSale(3);
    await api().post(`/api/sales/${saleId}/returns`).set(auth('employee')).send({ quantity: 1, condition: 'damaged', notes: null });

    await expect(undoService().undo(entryId, people.admin, null)).rejects.toThrow(/return first/i);
  });

  it('should allow it when the only return was rejected', async () => {
    const { saleId, entryId } = await employeeSale(3);
    const returned = await api().post(`/api/sales/${saleId}/returns`).set(auth('employee')).send({ quantity: 1, condition: 'damaged', notes: null });
    await api().post(`/api/returns/${returned.body.data.id}/reject`).set(auth('admin')).send({ note: 'no' });

    await expect(undoService().undo(entryId, people.admin, null)).resolves.toBeUndefined();
  });

  it('should refuse to restore when the units have been sold since', async () => {
    const { productId, entryId } = await employeeSale(3, 3);
    await undoService().undo(entryId, people.admin, null);
    await api().post('/api/sales').set(auth('admin')).send({ productId, quantity: 3 });

    await expect(undoService().restore(entryId, people.admin)).rejects.toThrow(/only 0 left/i);
    expect(await stockOf(context, productId)).toBe(0);
  });
});

describe('who may undo', () => {
  it('should not let an admin undo the owner’s sale', async () => {
    const productId = await createTestProduct(context, tokens.admin, { stock: 5 });
    await api().post('/api/sales').set(auth('owner')).send({ productId, quantity: 1 });

    await expect(undoService().undo(await entryOf('sale.recorded'), people.admin, null)).rejects.toThrow(/not allowed|can't undo/i);
  });

  it('should let the developer undo anyone, and not let an employee undo anything', async () => {
    const productId = await createTestProduct(context, tokens.admin, { stock: 5 });
    await api().post('/api/sales').set(auth('owner')).send({ productId, quantity: 1 });
    const entryId = await entryOf('sale.recorded');

    await expect(undoService().undo(entryId, people.employee, null)).rejects.toThrow(/not allowed|can't undo/i);
    await expect(undoService().undo(entryId, people.developer, null)).resolves.toBeUndefined();
  });
});

describe('undoing requests and stock changes', () => {
  it('should undo an approved damage report: the units come back', async () => {
    const productId = await createTestProduct(context, tokens.admin, { stock: 10 });
    const writeOff = await api().post('/api/write-offs').set(auth('employee')).send({ productId, quantity: 2, reason: 'damaged', notes: null });
    await api().post(`/api/write-offs/${writeOff.body.data.id}/approve`).set(auth('owner'));
    expect(await stockOf(context, productId)).toBe(8);

    await undoService().undo(await entryOf('write_off.requested'), people.owner, null);
    expect(await stockOf(context, productId)).toBe(10);

    await undoService().restore(await entryOf('write_off.requested'), people.owner);
    expect(await stockOf(context, productId)).toBe(8);
  });

  it('should undo a damaged return together with its write-off, without touching stock', async () => {
    const { productId, saleId } = await employeeSale(3);
    const returned = await api().post(`/api/sales/${saleId}/returns`).set(auth('employee')).send({ quantity: 1, condition: 'damaged', notes: null });
    await api().post(`/api/returns/${returned.body.data.id}/approve`).set(auth('admin'));
    const before = await stockOf(context, productId);

    await undoService().undo(await entryOf('return.requested'), people.admin, null);

    expect(await stockOf(context, productId)).toBe(before);
    const writeOff = await context.db.selectFrom('write_offs').select('undone_at').where('return_id', '=', returned.body.data.id).executeTakeFirstOrThrow();
    expect(writeOff.undone_at).not.toBeNull();
    expect(await revenueToday()).toBe(150);
  });

  it('should undo a resellable return: the units leave stock again', async () => {
    const { productId, saleId } = await employeeSale(3);
    await api().post(`/api/sales/${saleId}/returns`).set(auth('admin')).send({ quantity: 1, condition: 'resellable', notes: null });
    expect(await stockOf(context, productId)).toBe(8);

    await undoService().undo(await entryOf('return.requested'), people.admin, null);

    expect(await stockOf(context, productId)).toBe(7);
  });

  it('should reverse an approved count correction', async () => {
    const productId = await createTestProduct(context, tokens.admin, { stock: 10 });
    const count = await api().post('/api/stock-counts').set(auth('employee')).send({});
    await api().put(`/api/stock-counts/${count.body.data.id}/lines/${productId}`).set(auth('employee')).send({ countedQuantity: 7 });
    await api().post(`/api/stock-counts/${count.body.data.id}/submit`).set(auth('employee'));
    await api().post(`/api/stock-counts/${count.body.data.id}/lines/${productId}/approve`).set(auth('admin'));
    expect(await stockOf(context, productId)).toBe(7);

    await undoService().undo(await entryOf('count.line_approved'), people.admin, null);

    expect(await stockOf(context, productId)).toBe(10);
  });

  it('should undo and restore a stock change made by hand', async () => {
    const productId = await createTestProduct(context, tokens.admin, { stock: 10 });
    await api().patch(`/api/inventory/${productId}`).set(auth('admin')).send({ quantity: 5, reason: 'Restock' });
    const entryId = await entryOf('stock.adjusted');

    await undoService().undo(entryId, people.admin, null);
    expect(await stockOf(context, productId)).toBe(10);

    await undoService().restore(entryId, people.admin);
    expect(await stockOf(context, productId)).toBe(15);
  });

  it('should refuse entries that cannot be undone', async () => {
    await expect(undoService().undo(await entryOf('auth.logged_in'), people.developer, null)).rejects.toThrow(/can't be undone/i);
  });
});
