import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { UserRole } from '../src/database/types.js';
import { toPublicUser } from '../src/services/mappers.js';
import type { PublicUser } from '../src/types/auth.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
const people = {} as Record<'developer' | 'admin', PublicUser>;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  for (const role of ['developer', 'admin'] as const) {
    const token = await loginAs(context, role);
    if (role === 'admin') adminToken = token;
    const row = await context.db.selectFrom('users').selectAll().where('role', '=', role as UserRole).executeTakeFirstOrThrow();
    people[role] = toPublicUser(row);
  }
});
afterAll(() => context.db.destroy());

const services = () => context.container;
const undoService = () => context.container.undoService;

/** The newest activity entry with this action that isn't an undo's own change. */
async function entryOf(action: string): Promise<number> {
  const rows = await context.db.selectFrom('activity_log').select(['id', 'details']).where('action', '=', action).orderBy('id', 'desc').execute();
  const row = rows.find((entry) => !(entry.details && 'undoOf' in entry.details));
  if (!row) throw new Error(`No ${action} entry`);
  return row.id;
}

async function setPrice(productId: number, price: number) {
  const product = await services().productService.getById(productId, 'admin');
  await services().productService.update(
    productId,
    {
      name: product.name,
      description: product.description,
      categoryId: product.category.id,
      price,
      costPrice: product.costPrice ?? null,
      imageUrl: product.imageUrl,
      sku: product.sku,
      isActive: product.isActive,
    },
    people.admin.id,
  );
  return entryOf('product.updated');
}

const priceOf = async (productId: number) => (await services().productService.getById(productId, 'admin')).price;

describe('reverting a product edit', () => {
  it('should put the old price back, mark the edit undone, and restore it again', async () => {
    const productId = await createTestProduct(context, adminToken, { price: 89 });
    const entryId = await setPrice(productId, 79);

    await undoService().undo(entryId, people.developer, 'wrong product');

    expect(await priceOf(productId)).toBe(89);
    const entry = await context.db.selectFrom('activity_log').select(['undone_at', 'undo_note']).where('id', '=', entryId).executeTakeFirstOrThrow();
    expect(entry.undone_at).not.toBeNull();
    expect(entry.undo_note).toBe('wrong product');
    const revert = await context.db.selectFrom('activity_log').select('details').where('action', '=', 'product.updated').orderBy('id', 'desc').executeTakeFirstOrThrow();
    expect(revert.details).toMatchObject({ undoOf: entryId });

    await undoService().restore(entryId, people.developer);
    expect(await priceOf(productId)).toBe(79);
  });

  it('should only revert the latest change to the same field', async () => {
    const productId = await createTestProduct(context, adminToken, { price: 89 });
    const first = await setPrice(productId, 79);
    const second = await setPrice(productId, 85);

    await expect(undoService().undo(first, people.admin, null)).rejects.toThrow(/changed again since/i);
    await undoService().undo(second, people.admin, null);
    expect(await priceOf(productId)).toBe(79);
    await undoService().undo(first, people.admin, null);
    expect(await priceOf(productId)).toBe(89);
  });

  it('should refuse when the product was deleted since', async () => {
    const productId = await createTestProduct(context, adminToken, { price: 89 });
    const entryId = await setPrice(productId, 79);
    await services().productService.delete(productId, people.admin.id);

    await expect(undoService().undo(entryId, people.admin, null)).rejects.toThrow(/deleted/i);
    const entry = await context.db.selectFrom('activity_log').select('undone_at').where('id', '=', entryId).executeTakeFirstOrThrow();
    expect(entry.undone_at).toBeNull();
  });
});

describe('reverting other edits', () => {
  it('should revert bulk prices', async () => {
    const productId = await createTestProduct(context, adminToken, { price: 100 });
    await services().pricingService.replaceTiers(productId, [{ quantity: 5, price: 90 }], people.admin.id);

    await undoService().undo(await entryOf('pricing.updated'), people.admin, null);

    expect((await services().pricingService.getTiers(productId, true)).tiers).toEqual([]);
  });

  it('should revert a settings change', async () => {
    await services().settingsService.update({ refundApprovalLimit: 80 }, people.admin.id);

    await undoService().undo(await entryOf('settings.updated'), people.admin, null);

    expect((await services().settingsService.get()).refundApprovalLimit).toBe(50);
  });

  it('should revert a reorder level change', async () => {
    const productId = await createTestProduct(context, adminToken);
    await services().inventoryService.adjust(productId, { reorderLevel: 8, notes: null }, people.admin.id);

    await undoService().undo(await entryOf('stock.adjusted'), people.admin, null);

    expect((await services().inventoryService.getByProductId(productId)).reorderLevel).toBe(2);
  });

  it('should end a promotion on undo, and refuse to restart it', async () => {
    const productId = await createTestProduct(context, adminToken);
    const today = new Date().toISOString().slice(0, 10);
    const inAWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const created = await request(context.app)
      .post('/api/promotions')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ name: 'Autumn sale', percentOff: 10, productId, startsAt: today, endsAt: inAWeek });
    const entryId = await entryOf('promotion.created');

    await undoService().undo(entryId, people.admin, null);

    const promotion = await context.db.selectFrom('promotions').selectAll().where('id', '=', created.body.data.id).executeTakeFirstOrThrow();
    expect(promotion.ends_at.getTime()).toBeLessThanOrEqual(Date.now());
    await expect(undoService().restore(entryId, people.admin)).rejects.toThrow(/new promotion/i);
  });
});
