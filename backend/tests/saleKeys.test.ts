import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../src/database/types.js';
import { SALE_KEY_LOCK } from '../src/repositories/DocumentRepository.js';
import { createTestProduct, createTestUser, resetData, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers/testApp.js';

let context: TestContext;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(() => resetData(context.db));
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signIn(role: 'admin' | 'employee') {
  const user = await createTestUser(context.db, role);
  const response = await request(context.app).post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
  const businessId = (await context.db.selectFrom('memberships').select('business_id').where('user_id', '=', user.id).executeTakeFirstOrThrow()).business_id;
  return { id: user.id, token: response.body.data.token as string, businessId };
}

const basket = (token: string, key: string, items: Array<{ productId: number; quantity: number }>, extra: Record<string, unknown> = {}) =>
  request(context.app).post('/api/sales/basket').set(auth(token)).send({ items, clientKey: key, ...extra });

const documents = () => context.db.selectFrom('documents').select(['id', 'client_key']).where('client_key', 'is not', null).execute();

/**
 * Holds the key's lock from the test, as a request with that key would, until
 * `release` is called: what the server does meanwhile waits behind it.
 */
async function holdKey(businessId: number, key: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let locked!: () => void;
  const held = new Promise<void>((resolve) => (locked = resolve));
  let inside: Transaction<Database> | undefined;
  const done = context.db.transaction().execute(async (trx) => {
    inside = trx;
    await sql`select set_config('app.business_id', ${String(businessId)}, true)`.execute(trx);
    await sql`select pg_advisory_xact_lock(${SALE_KEY_LOCK}, hashtext(coalesce(current_business_id(), 0)::text || ':' || ${key}))`.execute(trx);
    locked();
    await released;
  });
  await held;
  return { trx: () => inside!, release: async () => (release(), await done) };
}

/** Until `count` requests wait on an advisory lock (the one the test holds). */
async function waitersOnLock(count: number) {
  for (let tries = 0; tries < 500; tries += 1) {
    const { rows } = await sql<{ n: number }>`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`.execute(context.db);
    if (rows[0]!.n >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Never saw ${count} request(s) waiting on the key`);
}

describe('Till sale keys', () => {
  it('should close a refused key, so a copy still on its way is refused too', async () => {
    const admin = await signIn('admin');
    const employee = await signIn('employee');
    const product = await createTestProduct(context, admin.token, { name: 'Vase', price: 20, stock: 2 });
    const key = randomUUID();

    const refused = await basket(employee.token, key, [{ productId: product, quantity: 5 }]);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('SALE_CLOSED');

    // The first copy of the sale arrives only now, and would fit: it never goes in.
    const late = await basket(employee.token, key, [{ productId: product, quantity: 2 }]);
    expect(late.status).toBe(410);
    expect(late.body.error).toBe('SALE_CLOSED');
    expect(await documents()).toHaveLength(0);

    // A new key sells it.
    expect((await basket(employee.token, randomUUID(), [{ productId: product, quantity: 2 }])).status).toBe(201);
  });

  it('should answer a resend that waited on the key with the sale the first copy recorded, even when it would be refused now', async () => {
    const admin = await signIn('admin');
    const employee = await signIn('employee');
    const product = await createTestProduct(context, admin.token, { name: 'Vase', price: 20, stock: 2 });
    const other = await basket(employee.token, randomUUID(), [{ productId: product, quantity: 2 }]);
    expect(other.status).toBe(201);
    const key = randomUUID();

    const lock = await holdKey(employee.businessId, key);
    // No stock is left, so this copy alone would be refused; it waits on the key.
    const resend = basket(employee.token, key, [{ productId: product, quantity: 2 }]).then((response) => response);
    await waitersOnLock(1);
    // Meanwhile the first copy's sale is in under this key.
    await lock.trx().updateTable('documents').set({ client_key: key }).where('id', '=', other.body.data.invoice.id).execute();
    await lock.release();

    const answer = await resend;
    expect(answer.status).toBe(201);
    expect(answer.body.data.again).toBe(true);
    expect(answer.body.data.invoice).toEqual(other.body.data.invoice);
    expect(await context.db.selectFrom('sale_key_closures').selectAll().execute()).toHaveLength(0);
  });

  it('should give the sale back, not a refusal, when it went in between the refusal and closing its key', async () => {
    const admin = await signIn('admin');
    const product = await createTestProduct(context, admin.token, { name: 'Vase', price: 20, stock: 5 });
    const other = await basket(admin.token, randomUUID(), [{ productId: product, quantity: 1 }]);
    const key = randomUUID();

    const lock = await holdKey(admin.businessId, key);
    // Refused before it takes the key (a promised day already gone); closing its key waits on the lock.
    const late = basket(admin.token, key, [{ productId: product, quantity: 1 }], { dueDate: '2020-01-01' }).then((response) => response);
    await waitersOnLock(1);
    await lock.trx().updateTable('documents').set({ client_key: key }).where('id', '=', other.body.data.invoice.id).execute();
    await lock.release();

    const answer = await late;
    expect(answer.status).toBe(201);
    expect(answer.body.data.again).toBe(true);
    expect(await context.db.selectFrom('sale_key_closures').selectAll().execute()).toHaveLength(0);
  });

  it('should tell a resend of a sold offer its sale, not that the offer was sold', async () => {
    const admin = await signIn('admin');
    const product = await createTestProduct(context, admin.token, { name: 'Vase', price: 20, stock: 5 });
    const offer = await request(context.app)
      .post('/api/offers')
      .set(auth(admin.token))
      .send({ partyName: 'Arben', lines: [{ productId: product, quantity: 1, unitPrice: 15 }] });
    expect(offer.status).toBe(201);
    const key = randomUUID();
    const sell = () => basket(admin.token, key, [{ productId: product, quantity: 1, offerPrice: 15 } as never], { offerId: offer.body.data.id });

    const first = await sell();
    expect(first.status).toBe(201);
    expect(first.body.data.again).toBe(false);
    const again = await sell();
    expect(again.status).toBe(201);
    expect(again.body.data.again).toBe(true);
    expect(again.body.data.invoice).toEqual(first.body.data.invoice);
  });

  it('should stop a key: the sale if it went in, else it never will', async () => {
    const admin = await signIn('admin');
    const product = await createTestProduct(context, admin.token, { name: 'Vase', price: 20, stock: 5 });
    const stop = (key: string, token = admin.token) => request(context.app).post(`/api/sales/basket/${key}/stop`).set(auth(token)).send({});

    const unknown = randomUUID();
    const stopped = await stop(unknown);
    expect(stopped.status).toBe(200);
    expect(stopped.body.data).toEqual({ state: 'stopped' });
    const late = await basket(admin.token, unknown, [{ productId: product, quantity: 1 }]);
    expect(late.status).toBe(410);
    expect(late.body.error).toBe('SALE_CLOSED');
    expect((await stop(unknown)).body.data).toEqual({ state: 'stopped' });

    const sold = randomUUID();
    const first = await basket(admin.token, sold, [{ productId: product, quantity: 1 }]);
    const found = await stop(sold);
    expect(found.body.data.state).toBe('recorded');
    expect(found.body.data.sale.invoice).toEqual(first.body.data.invoice);
    expect(found.body.data.sale.again).toBe(true);

    expect((await stop('not-a-key')).status).toBe(400);
  });

  it('should settle a stop and a sale on their way at once one way only', async () => {
    const admin = await signIn('admin');
    const product = await createTestProduct(context, admin.token, { name: 'Vase', price: 20, stock: 5 });
    const key = randomUUID();

    const lock = await holdKey(admin.businessId, key);
    const sale = basket(admin.token, key, [{ productId: product, quantity: 1 }]).then((response) => response);
    const stop = request(context.app).post(`/api/sales/basket/${key}/stop`).set(auth(admin.token)).send({}).then((response) => response);
    await waitersOnLock(2);
    await lock.release();
    const [sold, stopped] = await Promise.all([sale, stop]);

    const recorded = (await documents()).length;
    if (sold.status === 201) {
      expect(stopped.body.data.state).toBe('recorded');
      expect(recorded).toBe(1);
    } else {
      expect(sold.status).toBe(410);
      expect(stopped.body.data).toEqual({ state: 'stopped' });
      expect(recorded).toBe(0);
    }
  });

  it('should say when an answer is a sale recorded before, with its fiscal receipt', async () => {
    const admin = await signIn('admin');
    const product = await createTestProduct(context, admin.token, { name: 'Vase', price: 20, stock: 5 });
    const key = randomUUID();
    const first = await basket(admin.token, key, [{ productId: product, quantity: 1 }]);
    expect(first.body.data).toMatchObject({ again: false, fiscalNo: null });
    await context.db.updateTable('documents').set({ fiscal_receipt_no: '00042' }).where('id', '=', first.body.data.invoice.id).execute();
    const again = await basket(admin.token, key, [{ productId: product, quantity: 1 }]);
    expect(again.body.data).toMatchObject({ again: true, fiscalNo: '00042' });
  });
});

describe('Till writes for whoever was signed in', () => {
  it('should refuse a write meant for another person or business, and leave its key open', async () => {
    const admin = await signIn('admin');
    const employee = await signIn('employee');
    const product = await createTestProduct(context, admin.token, { name: 'Vase', price: 20, stock: 5 });
    const key = randomUUID();
    const send = (owner: string) => basket(employee.token, key, [{ productId: product, quantity: 1 }]).set('X-Expect-Owner', owner);

    const otherPerson = await send(`${employee.businessId}:${admin.id}`);
    expect(otherPerson.status).toBe(409);
    expect(otherPerson.body.error).toBe('OWNER_CHANGED');
    const otherBusiness = await send(`${employee.businessId + 1000}:${employee.id}`);
    expect(otherBusiness.body.error).toBe('OWNER_CHANGED');
    expect(await context.db.selectFrom('sale_key_closures').selectAll().execute()).toHaveLength(0);

    // Its own person in its own business: recorded.
    expect((await send(`${employee.businessId}:${employee.id}`)).status).toBe(201);

    const events = await request(context.app)
      .post('/api/counter/events')
      .set(auth(employee.token))
      .set('X-Expect-Owner', `${employee.businessId}:${admin.id}`)
      .send({ events: [{ kind: 'x_report', clientId: randomUUID(), at: new Date().toISOString() }] });
    expect(events.status).toBe(409);
    expect(events.body.error).toBe('OWNER_CHANGED');
    expect(await context.db.selectFrom('counter_events').selectAll().execute()).toHaveLength(0);
  });
});
