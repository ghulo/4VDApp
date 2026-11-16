import { readFileSync } from 'node:fs';
import type { Router } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createApiRoutes } from '../src/routes/index.js';
import { createPortalRoutes } from '../src/routes/portalRoutes.js';
import { createTestCategory, createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;

const ORIGIN = 'http://localhost:5173';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  await context.db.deleteFrom('portal_users').execute();
  adminToken = await loginAs(context, 'admin');
});
afterAll(() => context.db.destroy());

async function customer(name: string, extra: Record<string, unknown> = {}): Promise<number> {
  const response = await api().post('/api/customers').set(auth(adminToken)).send({ name, kind: 'business', nui: String(810000000 + Math.floor(Math.random() * 99999999)), phone: '044 123 456', ...extra });
  if (!response.body.data) throw new Error(JSON.stringify(response.body));
  return response.body.data.id;
}

async function portalOn(customerId: number, extra: Record<string, unknown> = {}) {
  const response = await api()
    .put(`/api/portal-admin/customers/${customerId}`)
    .set(auth(adminToken))
    .send({ enabled: true, canOrder: true, minOrder: null, categories: null, ...extra });
  expect(response.status).toBe(200);
  return response.body.data;
}

async function invite(customerId: number, body: Record<string, unknown> = {}) {
  const response = await api().post(`/api/portal-admin/customers/${customerId}/people`).set(auth(adminToken)).send({ name: 'Besa', ...body });
  expect(response.status).toBe(201);
  return { ...response.body.data, token: String(response.body.data.link).split('#')[1]! };
}

/** Signs a new person at this customer in and returns their cookie. */
async function signIn(customerId: number, body: Record<string, unknown> = {}): Promise<string> {
  const { token } = await invite(customerId, body);
  const used = await api().post('/api/portal/links/use').set('Origin', ORIGIN).send({ token });
  expect(used.status).toBe(200);
  const cookie = ([] as string[]).concat(used.headers['set-cookie'] ?? [])[0]!;
  return cookie.split(';')[0]!;
}

const portal = (cookie: string) => ({
  get: (path: string) => api().get(`/api/portal${path}`).set('Cookie', cookie),
  post: (path: string, body: object = {}) => api().post(`/api/portal${path}`).set('Cookie', cookie).set('Origin', ORIGIN).send(body),
});

/** Every key anywhere in a JSON answer. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, into));
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key);
      keysOf(inner, into);
    }
  }
  return into;
}

/** Every route of a router as method + path, with :params filled in with 1. */
function routesOf(router: Router, prefix = ''): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  for (const layer of (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) out.push({ method, path: `${prefix}${layer.route.path}`.replace(/:[A-Za-z]+/g, '1') });
  }
  return out;
}

describe('isolation', () => {
  it('gives a portal cookie nothing on any dashboard route', async () => {
    const arta = await customer('Kafe Arta');
    await portalOn(arta);
    const cookie = await signIn(arta);

    // The mount points, in the order routes/index.ts adds them, matched to the sub-routers it adds.
    const source = readFileSync(new URL('../src/routes/index.ts', import.meta.url), 'utf8');
    const prefixes = [...source.matchAll(/router\.use\('([^']+)'/g)].map((match) => match[1]!);
    const root = createApiRoutes(context.container) as unknown as { stack: Array<{ handle: Router; name: string }> };
    const mounted = root.stack.filter((layer) => layer.name === 'router');
    expect(mounted).toHaveLength(prefixes.length);
    const routes = mounted.flatMap((layer, index) => routesOf(layer.handle, `/api${prefixes[index]}`));
    expect(routes.length).toBeGreaterThan(300);

    let refused = 0;
    let walker = context.app;
    for (const [index, route] of routes.entries()) {
      // A fresh app every few routes, so the anonymous rate limit never answers instead of the route.
      if (index % 40 === 0) walker = createApp(context.config, context.db, { container: context.container });
      const call = (withCookie: boolean) => {
        const r = (request(walker) as unknown as Record<string, (path: string) => request.Test>)[route.method]!(route.path).set('Origin', ORIGIN);
        return withCookie ? r.set('Cookie', cookie).send({}) : r.send({});
      };
      // The cookie must change nothing: a dashboard route answers it exactly as it answers nobody.
      const [anonymous, withCookie] = [await call(false), await call(true)];
      expect({ route, status: withCookie.status }).toEqual({ route, status: anonymous.status });
      if (withCookie.status === 401) refused += 1;
    }
    expect(refused).toBeGreaterThan(280);
  }, 120_000);

  it('gives a dashboard token nothing on the portal', async () => {
    const routes = routesOf(createPortalRoutes(context.container), '/api/portal');
    const open = new Set(['/api/portal/links', '/api/portal/links/peek', '/api/portal/links/use', '/api/portal/sign-out']);
    const guarded = routes.filter((route) => !open.has(route.path));
    expect(guarded.length).toBeGreaterThan(10);
    for (const route of guarded) {
      const response = await (api() as unknown as Record<string, (path: string) => request.Test>)[route.method]!(route.path).set(auth(adminToken)).set('Origin', ORIGIN).send({});
      expect({ route, status: response.status }).toEqual({ route, status: 401 });
    }
  });

  it("never shows one customer another's orders, invoices or balance", async () => {
    const product = await createTestProduct(context, adminToken, { name: 'Kafe', price: 10, costPrice: 4, stock: 20 });
    const arta = await customer('Kafe Arta', { payLater: true });
    const besa = await customer('Bar Besa', { payLater: true });
    await portalOn(arta);
    await portalOn(besa);
    const artaCookie = await signIn(arta);
    const besaCookie = await signIn(besa, { name: 'Drita' });

    const besaOrder = (await portal(besaCookie).post('/orders', { lines: [{ productId: product, quantity: 2 }], note: null })).body.data;
    const sale = await api().post('/api/sales/basket').set(auth(adminToken)).send({ items: [{ productId: product, quantity: 3 }], notes: null, customerId: besa, paidNow: false });
    expect(sale.status).toBe(201);
    const besaInvoice = sale.body.data.invoice.id;

    const a = portal(artaCookie);
    expect((await a.get(`/orders/${besaOrder.id}`)).status).toBe(404);
    expect((await a.get(`/orders/${besaOrder.id}/again`)).status).toBe(404);
    expect((await a.post(`/orders/${besaOrder.id}/cancel`)).status).toBe(404);
    expect((await a.get(`/invoices/${besaInvoice}/print`)).status).toBe(404);
    expect((await a.get('/orders')).body.data).toEqual([]);
    expect((await a.get('/invoices')).body.data).toEqual([]);
    expect((await a.get('/account')).body.data.balance).toBe(0);
    expect((await a.get(`/statement?from=2020-01-01&to=2099-12-31`)).body.data.lines).toEqual([]);

    // Besa sees her own.
    const b = portal(besaCookie);
    expect((await b.get('/invoices')).body.data.map((d: { id: number }) => d.id)).toEqual([besaInvoice]);
    expect((await b.get(`/invoices/${besaInvoice}/print`)).text).toContain(sale.body.data.invoice.number);
    expect((await b.get('/account')).body.data.balance).toBe(30);
  });

  it('shows credit notes next to invoices', async () => {
    const product = await createTestProduct(context, adminToken, { name: 'Kafe', price: 10, costPrice: 4, stock: 20 });
    const arta = await customer('Kafe Arta');
    await portalOn(arta);
    const cookie = await signIn(arta);
    const sale = (await api().post('/api/sales/basket').set(auth(adminToken)).send({ items: [{ productId: product, quantity: 2 }], notes: null, customerId: arta })).body.data;
    const returned = await api().post(`/api/sales/${sale.sales[0].id}/returns`).set(auth(adminToken)).send({ quantity: 1, condition: 'resellable', refundAmount: 10, notes: 'broken' });
    expect(returned.status).toBeLessThan(300);
    const kinds = (await portal(cookie).get('/invoices')).body.data.map((d: { kind: string }) => d.kind).sort();
    expect(kinds).toEqual(['credit_note', 'invoice']);
  });
});

describe('prices and products', () => {
  it('shows this customer’s own prices with and without VAT, and never a cost or a stock count', async () => {
    const shelfOnly = await createTestProduct(context, adminToken, { name: 'Ujë', price: 1.18, costPrice: 0.5, stock: 0 });
    const wholesale = await createTestProduct(context, adminToken, { name: 'Kafe', price: 11.8, costPrice: 6, stock: 40 });
    await api().put(`/api/products/${wholesale}`).set(auth(adminToken)).send({ wholesalePrice: 9.44 });
    await context.db.updateTable('products').set({ wholesale_price: '9.44' }).where('id', '=', wholesale).execute();
    const arta = await customer('Kafe Arta', { paysWholesale: true });
    await context.db.updateTable('customers').set({ pays_wholesale: true }).where('id', '=', arta).execute();
    await portalOn(arta);
    const cookie = await signIn(arta);

    const list = (await portal(cookie).get('/products')).body.data;
    const kafe = list.products.find((p: { id: number }) => p.id === wholesale);
    expect(kafe).toMatchObject({ price: 9.44, net: 8, vatRate: 18, inStock: true });
    expect(list.products.find((p: { id: number }) => p.id === shelfOnly)).toMatchObject({ price: 1.18, inStock: false });

    const quote = (await portal(cookie).post('/quote', { lines: [{ productId: wholesale, quantity: 2 }] })).body.data;
    expect(quote).toMatchObject({ net: 16, vat: 2.88, total: 18.88 });

    const keys = keysOf([list, quote, (await portal(cookie).post('/orders', { lines: [{ productId: wholesale, quantity: 1 }], note: null })).body]);
    for (const leak of ['cost', 'costPrice', 'cost_price', 'margin', 'quantityOnHand', 'quantity_on_hand', 'stock', 'basePrice', 'base_price', 'wholesalePrice', 'wholesale_price']) {
      expect(keys.has(leak)).toBe(false);
    }
  });

  it('shows only the categories the shop chose, and refuses an order for a hidden product', async () => {
    const drinks = await createTestCategory(context.db, 'Pije');
    const tools = await createTestCategory(context.db, 'Vegla');
    const juice = await createTestProduct(context, adminToken, { name: 'Lëng', price: 2, stock: 5, categoryId: drinks.id });
    const hammer = await createTestProduct(context, adminToken, { name: 'Çekiç', price: 8, stock: 5, categoryId: tools.id });
    const arta = await customer('Kafe Arta');
    await portalOn(arta, { categories: [drinks.id] });
    const cookie = await signIn(arta);

    const list = (await portal(cookie).get('/products')).body.data;
    expect(list.products.map((p: { id: number }) => p.id)).toEqual([juice]);
    expect(list.categories.map((c: { id: number }) => c.id)).toEqual([drinks.id]);
    expect((await portal(cookie).post('/quote', { lines: [{ productId: hammer, quantity: 1 }] })).body.data.missing).toEqual([hammer]);
    expect((await portal(cookie).post('/orders', { lines: [{ productId: hammer, quantity: 1 }], note: null })).status).toBe(409);
  });
});

describe('ordering', () => {
  it('sends an order to the shop, which sees it, accepts it as an offer at the same prices, and the customer follows it', async () => {
    const product = await createTestProduct(context, adminToken, { name: 'Kafe', price: 10, costPrice: 4, stock: 0 });
    const arta = await customer('Kafe Arta');
    await portalOn(arta, { minOrder: 25 });
    const cookie = await signIn(arta);
    const p = portal(cookie);

    const small = await p.post('/orders', { lines: [{ productId: product, quantity: 2 }], note: null });
    expect(small.status).toBe(400);
    expect(small.body.message).toContain('€25.00');
    expect((await p.post('/orders', { lines: [{ productId: product, quantity: 1.5 }], note: null })).status).toBe(400);

    // Out of stock can still be ordered; the line says so.
    const sent = await p.post('/orders', { lines: [{ productId: product, quantity: 3 }], note: 'Para orës 9' });
    expect(sent.status).toBe(201);
    expect(sent.body.data).toMatchObject({ state: 'sent', total: 30, canCancel: true, lines: [{ quantity: 3, unitPrice: 10, inStock: false }] });
    const id = sent.body.data.id;

    // To do, an alert and Activity on the shop's side.
    const todo = (await api().get('/api/attention').set(auth(adminToken))).body.data.todo;
    expect(todo.some((item: { key: string }) => item.key === `portal_order:${id}`)).toBe(true);
    const alerts = await context.db.selectFrom('notifications').select('type').where('type', '=', 'portal_order').execute();
    expect(alerts.length).toBeGreaterThan(0);
    const logged = await context.db.selectFrom('activity_log').select('action').where('entity_type', '=', 'portal_order').execute();
    expect(logged.map((row) => row.action)).toContain('portal.order_sent');

    // Opening it marks it seen; the customer can no longer cancel.
    expect((await api().get(`/api/portal-admin/orders/${id}`).set(auth(adminToken))).body.data.status).toBe('seen');
    expect((await p.get(`/orders/${id}`)).body.data).toMatchObject({ state: 'seen', canCancel: false });
    expect((await p.post(`/orders/${id}/cancel`)).status).toBe(409);

    // Prices change after the order; the offer keeps what the customer saw.
    await context.db.updateTable('products').set({ base_price: '12.00' }).where('id', '=', product).execute();
    const accepted = await api().post(`/api/portal-admin/orders/${id}/accept`).set(auth(adminToken));
    expect(accepted.status).toBe(200);
    const offer = (await api().get(`/api/offers/${accepted.body.data.offer.id}`).set(auth(adminToken))).body.data;
    expect(offer).toMatchObject({ total: 30, customer: { id: arta } });
    expect((await p.get(`/orders/${id}`)).body.data).toMatchObject({ state: 'offered', offer: { number: offer.number, total: 30 } });
    expect((await api().post(`/api/portal-admin/orders/${id}/accept`).set(auth(adminToken))).status).toBe(409);

    // Order again: the same products at today's price.
    const again = (await p.get(`/orders/${id}/again`)).body.data;
    expect(again).toMatchObject({ total: 36, lines: [{ productId: product, quantity: 3, unitPrice: 12 }] });
  });

  it('lets a customer cancel while it is only sent, and the shop decline with a reason', async () => {
    const product = await createTestProduct(context, adminToken, { name: 'Kafe', price: 10, stock: 5 });
    const arta = await customer('Kafe Arta');
    await portalOn(arta);
    const p = portal(await signIn(arta));
    const first = (await p.post('/orders', { lines: [{ productId: product, quantity: 1 }], note: null })).body.data;
    expect((await p.post(`/orders/${first.id}/cancel`)).body.data.state).toBe('cancelled');

    const second = (await p.post('/orders', { lines: [{ productId: product, quantity: 1 }], note: null })).body.data;
    await api().post(`/api/portal-admin/orders/${second.id}/decline`).set(auth(adminToken)).send({ reason: 'Mbaroi' });
    expect((await p.get(`/orders/${second.id}`)).body.data).toMatchObject({ state: 'declined', declineReason: 'Mbaroi' });
  });

  it('lets the shop change an order with a reason; the customer is told, sees what changed, and must agree before it can be accepted', async () => {
    const kafe = await createTestProduct(context, adminToken, { name: 'Kafe', price: 10, stock: 5 });
    const caj = await createTestProduct(context, adminToken, { name: 'Çaj', price: 4, stock: 5 });
    const arta = await customer('Kafe Arta');
    await portalOn(arta);
    const p = portal(await signIn(arta, { email: 'besa@arta.test' }));
    const order = (await p.post('/orders', { lines: [{ productId: kafe, quantity: 5 }], note: null })).body.data;
    const shop = (path: string) => `/api/portal-admin/orders/${order.id}${path}`;

    // A reason is required.
    expect((await api().put(shop('')).set(auth(adminToken)).send({ lines: [{ productId: kafe, quantity: 3 }], reason: ' ' })).status).toBe(400);
    const changed = await api()
      .put(shop(''))
      .set(auth(adminToken))
      .send({ lines: [{ productId: kafe, quantity: 3 }, { productId: caj, quantity: 2 }], reason: 'Only 3 left' });
    expect(changed.status).toBe(200);
    expect(changed.body.data).toMatchObject({ status: 'changed', total: 38, change: { reason: 'Only 3 left', previous: { total: 50 } } });

    // The firm is emailed, the Orders tab shows a dot until the order is opened.
    const outbox = await context.db.selectFrom('email_outbox').select(['to_address', 'subject']).execute();
    expect(outbox.some((row) => row.to_address === 'besa@arta.test' && row.subject.includes(`#${order.id}`))).toBe(true);
    expect((await p.get('/me')).body.data.unseenChanges).toBe(1);
    const seen = (await p.get(`/orders/${order.id}`)).body.data;
    expect(seen).toMatchObject({
      state: 'changed',
      canAgree: true,
      canCancel: true,
      total: 38,
      lines: [{ productId: kafe, quantity: 3 }, { productId: caj, quantity: 2 }],
      change: { reason: 'Only 3 left', previous: { lines: [{ productId: kafe, quantity: 5 }] } },
    });
    expect((await p.get('/me')).body.data.unseenChanges).toBe(0);

    // Not accepted before the customer agrees; afterwards the offer has the new lines.
    expect((await api().post(shop('/accept')).set(auth(adminToken))).status).toBe(409);
    const agreed = await p.post(`/orders/${order.id}/agree`);
    expect(agreed.body.data).toMatchObject({ state: 'seen', canAgree: false, change: { agreed: true } });
    expect((await p.post(`/orders/${order.id}/agree`)).status).toBe(409);
    const logged = await context.db.selectFrom('activity_log').select('action').where('entity_type', '=', 'portal_order').execute();
    expect(logged.map((row) => row.action)).toEqual(expect.arrayContaining(['portal.order_changed', 'portal.change_agreed']));
    const accepted = await api().post(shop('/accept')).set(auth(adminToken));
    expect(accepted.status).toBe(200);
    expect((await api().get(`/api/offers/${accepted.body.data.offer.id}`).set(auth(adminToken))).body.data.total).toBe(38);
    expect((await api().put(shop('')).set(auth(adminToken)).send({ lines: [{ productId: kafe, quantity: 1 }], reason: 'x' })).status).toBe(409);
  });

  it('lets a customer cancel a changed order instead of agreeing, and the shop hears of it', async () => {
    const kafe = await createTestProduct(context, adminToken, { name: 'Kafe', price: 10, stock: 5 });
    const arta = await customer('Kafe Arta');
    await portalOn(arta);
    const p = portal(await signIn(arta));
    const order = (await p.post('/orders', { lines: [{ productId: kafe, quantity: 5 }], note: null })).body.data;
    await api().put(`/api/portal-admin/orders/${order.id}`).set(auth(adminToken)).send({ lines: [{ productId: kafe, quantity: 2 }], reason: 'Mbaroi' });
    await context.db.deleteFrom('notifications').execute();
    expect((await p.post(`/orders/${order.id}/cancel`)).body.data.state).toBe('cancelled');
    const alerts = await context.db.selectFrom('notifications').select('type').where('type', '=', 'portal_order').execute();
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('refuses orders when the shop switched ordering off', async () => {
    const product = await createTestProduct(context, adminToken, { name: 'Kafe', price: 10, stock: 5 });
    const arta = await customer('Kafe Arta');
    await portalOn(arta, { canOrder: false });
    const p = portal(await signIn(arta));
    expect((await p.post('/orders', { lines: [{ productId: product, quantity: 1 }], note: null })).status).toBe(403);
    // Prices and invoices stay open to them.
    expect((await p.get('/products')).status).toBe(200);
  });
});

describe('signing in', () => {
  it('sets a safe cookie, spends a link once, and a peek spends nothing', async () => {
    const arta = await customer('Kafe Arta');
    await portalOn(arta);
    const { token } = await invite(arta);
    expect((await api().post('/api/portal/links/peek').set('Origin', ORIGIN).send({ token })).body.data).toMatchObject({ purpose: 'invite', customer: 'Kafe Arta', name: 'Besa' });
    const used = await api().post('/api/portal/links/use').set('Origin', ORIGIN).send({ token });
    const cookie = ([] as string[]).concat(used.headers['set-cookie'] ?? [])[0]!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/portal/);
    expect((await api().post('/api/portal/links/use').set('Origin', ORIGIN).send({ token })).status).toBe(404);
    // Only the hash is kept.
    const stored = await context.db.selectFrom('portal_links').select('token_hash').execute();
    expect(stored.every((row) => row.token_hash !== token)).toBe(true);
  });

  it('refuses changes that don’t come from the portal’s own pages', async () => {
    const arta = await customer('Kafe Arta');
    await portalOn(arta);
    const cookie = await signIn(arta);
    expect((await api().post('/api/portal/orders').set('Cookie', cookie).send({ lines: [], note: null })).status).toBe(403);
    expect((await api().post('/api/portal/orders').set('Cookie', cookie).set('Origin', 'https://evil.example').send({ lines: [], note: null })).status).toBe(403);
  });

  it('signs everyone out at once when the portal is switched off or a person is removed', async () => {
    const arta = await customer('Kafe Arta');
    await portalOn(arta);
    const cookie = await signIn(arta);
    expect((await portal(cookie).get('/me')).status).toBe(200);
    await portalOn(arta, { enabled: false });
    expect((await portal(cookie).get('/me')).status).toBe(401);

    await portalOn(arta);
    const second = await invite(arta, { name: 'Gent' });
    const used = await api().post('/api/portal/links/use').set('Origin', ORIGIN).send({ token: second.token });
    const gent = ([] as string[]).concat(used.headers['set-cookie'] ?? [])[0]!.split(';')[0]!;
    expect((await portal(gent).get('/me')).status).toBe(200);
    await api().delete(`/api/portal-admin/customers/${arta}/people/${second.person.id}`).set(auth(adminToken));
    expect((await portal(gent).get('/me')).status).toBe(401);
  });

  it('answers a sign-in link request the same for a known and an unknown address, and emails only the known one', async () => {
    const sent: string[] = [];
    const arta = await customer('Kafe Arta');
    await portalOn(arta);
    await invite(arta, { email: 'besa@arta.test' });
    const known = await api().post('/api/portal/links').set('Origin', ORIGIN).send({ email: 'BESA@arta.test' });
    const unknown = await api().post('/api/portal/links').set('Origin', ORIGIN).send({ email: 'nobody@arta.test' });
    expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    const outbox = await context.db.selectFrom('email_outbox').select(['to_address']).execute();
    for (const row of outbox) sent.push(row.to_address);
    expect(sent).toEqual(['besa@arta.test']);
  });

  it('lets only the owner or a manager invite people or switch the portal on', async () => {
    const arta = await customer('Kafe Arta');
    const employee = await loginAs(context, 'employee');
    const owner = await loginAs(context, 'owner');
    const body = { enabled: true, canOrder: true, minOrder: null, categories: null };
    expect((await api().put(`/api/portal-admin/customers/${arta}`).set(auth(employee)).send(body)).status).toBe(403);
    expect((await api().put(`/api/portal-admin/customers/${arta}`).set(auth(owner)).send(body)).status).toBe(200);
    expect((await api().post(`/api/portal-admin/customers/${arta}/people`).set(auth(employee)).send({ name: 'X' })).status).toBe(403);
    expect((await api().post(`/api/portal-admin/customers/${arta}/people`).set(auth(owner)).send({ name: 'X' })).status).toBe(201);
  });
});
