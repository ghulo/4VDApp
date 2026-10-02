import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PushMessage } from '../src/services/push/senders.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

/** Records what would have been sent; tokens in `dead` are reported as gone. */
function fakeSender() {
  const sender = {
    sent: [] as PushMessage[],
    dead: new Set<string>(),
    async send(messages: PushMessage[]) {
      sender.sent.push(...messages);
      return { deadTokens: messages.map((message) => message.token).filter((token) => sender.dead.has(token)) };
    },
  };
  return sender;
}

const expo = fakeSender();
const web = fakeSender();
let context: TestContext;
let adminToken: string;
let employeeToken: string;

beforeAll(async () => {
  context = await setupTestApp({ pushSenders: { expo, web } });
});
beforeEach(async () => {
  await resetData(context.db);
  expo.sent.length = 0;
  web.sent.length = 0;
  expo.dead.clear();
  adminToken = await loginAs(context, 'admin');
  employeeToken = await loginAs(context, 'employee');
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const PHONE = 'ExponentPushToken[phone-1]';
const BROWSER = {
  kind: 'web',
  endpoint: 'https://push.example.com/send/abc',
  keys: { p256dh: 'BPublicKey', auth: 'secret' },
};

const addDevice = (token: string, body: Record<string, unknown>) =>
  request(context.app).post('/api/notifications/push/devices').set(auth(token)).send(body);

/** Selling down to the reorder level makes a low-stock notification for admins. */
async function causeLowStockAlert() {
  const productId = await createTestProduct(context, adminToken, { stock: 3, reorderLevel: 2 });
  await request(context.app).post('/api/sales').set(auth(employeeToken)).send({ productId, quantity: 1 });
}

describe('push alerts', () => {
  it('should push a new notification once to each of the owner’s devices', async () => {
    await addDevice(adminToken, { kind: 'expo', token: PHONE });
    await addDevice(adminToken, BROWSER);
    await causeLowStockAlert();

    const sent = await context.container.pushService.sendPending();
    const sentAgain = await context.container.pushService.sendPending();

    expect(sent).toBe(2);
    expect(sentAgain).toBe(0);
    expect(expo.sent).toEqual([expect.objectContaining({ token: PHONE, title: 'Low stock: Oak Chair' })]);
    expect(web.sent).toEqual([expect.objectContaining({ token: BROWSER.endpoint, keys: BROWSER.keys })]);
  });

  it('should respect a topic switched off', async () => {
    await addDevice(adminToken, { kind: 'expo', token: PHONE });
    const saved = await request(context.app)
      .put('/api/notifications/push/preferences')
      .set(auth(adminToken))
      .send({ stock: false });
    await causeLowStockAlert();

    await context.container.pushService.sendPending();

    expect(saved.body.data.topics).toEqual([
      { topic: 'stock', enabled: false },
      { topic: 'approvals', enabled: true },
    ]);
    expect(expo.sent).toHaveLength(0);
  });

  it('should tell an employee when the owner decides on their request', async () => {
    const productId = await createTestProduct(context, adminToken, { stock: 10 });
    await addDevice(employeeToken, { kind: 'expo', token: PHONE });
    const writeOff = await request(context.app)
      .post('/api/write-offs')
      .set(auth(employeeToken))
      .send({ productId, quantity: 1, reason: 'damaged' });
    await context.container.pushService.sendPending(); // the admin's "waiting" alert; admin has no device
    await request(context.app).post(`/api/write-offs/${writeOff.body.data.id}/approve`).set(auth(adminToken));

    await context.container.pushService.sendPending();
    const settings = await request(context.app).get('/api/notifications/push').set(auth(employeeToken));

    expect(expo.sent).toEqual([expect.objectContaining({ data: expect.objectContaining({ type: 'approval_decision' }) })]);
    expect(settings.body.data).toMatchObject({ topics: [{ topic: 'decisions', enabled: true }], deviceCount: 1 });
  });

  it('should forget devices that no longer exist, and move a device to whoever logs in on it', async () => {
    await addDevice(adminToken, { kind: 'expo', token: PHONE });
    await addDevice(employeeToken, { kind: 'expo', token: PHONE });
    const adminDevices = await request(context.app).get('/api/notifications/push').set(auth(adminToken));

    await addDevice(adminToken, { kind: 'expo', token: PHONE });
    expo.dead.add(PHONE);
    await causeLowStockAlert();
    await context.container.pushService.sendPending();
    const left = await context.db.selectFrom('push_subscriptions').selectAll().execute();

    expect(adminDevices.body.data.deviceCount).toBe(0);
    expect(left).toHaveLength(0);
  });

  it('should not send alerts that are too old', async () => {
    await addDevice(adminToken, { kind: 'expo', token: PHONE });
    await causeLowStockAlert();
    await sql`UPDATE notifications SET created_at = now() - interval '1 hour'`.execute(context.db);

    await context.container.pushService.sendPending();

    expect(expo.sent).toHaveLength(0);
  });

  it('should reject a token that is not a push token, and let people remove a device', async () => {
    const bad = await addDevice(adminToken, { kind: 'expo', token: 'hello' });
    await addDevice(adminToken, BROWSER);
    const removed = await request(context.app)
      .delete('/api/notifications/push/devices')
      .set(auth(adminToken))
      .send({ token: BROWSER.endpoint });

    expect(bad.status).toBe(400);
    expect(removed.body.data.deviceCount).toBe(0);
  });
});
