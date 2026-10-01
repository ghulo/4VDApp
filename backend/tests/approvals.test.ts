import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let employeeToken: string;
let productId: number;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
  employeeToken = await loginAs(context, 'employee');
  productId = await createTestProduct(context, adminToken, { price: 10, stock: 20 });
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);

/** One pending return, one pending write-off and one count with one pending line. */
async function createPendingItems() {
  const sale = await api().post('/api/sales').set(auth(employeeToken)).send({ productId, quantity: 8 });
  const ret = await api()
    .post(`/api/sales/${sale.body.data.id}/returns`)
    .set(auth(employeeToken))
    .send({ quantity: 8, condition: 'resellable' });
  const writeOff = await api().post('/api/write-offs').set(auth(employeeToken)).send({ productId, quantity: 1, reason: 'lost' });
  const count = await api().post('/api/stock-counts').set(auth(employeeToken)).send({});
  await api().put(`/api/stock-counts/${count.body.data.id}/lines/${productId}`).set(auth(employeeToken)).send({ countedQuantity: 1 });
  await api().post(`/api/stock-counts/${count.body.data.id}/submit`).set(auth(employeeToken));
  return { returnId: ret.body.data.id as number, writeOffId: writeOff.body.data.id as number, countId: count.body.data.id as number };
}

describe('approvals', () => {
  it('should count what is waiting for the owner', async () => {
    await createPendingItems();

    const response = await api().get('/api/approvals/summary').set(auth(adminToken));

    expect(response.body.data).toEqual({ returns: 1, writeOffs: 1, countLines: 1, total: 3 });
  });

  it('should keep the summary for admins only', async () => {
    const response = await api().get('/api/approvals/summary').set(auth(employeeToken));

    expect(response.status).toBe(403);
  });

  it("should list an employee's own requests, newest first, with the owner's reason", async () => {
    const { writeOffId } = await createPendingItems();
    await api().post(`/api/write-offs/${writeOffId}/reject`).set(auth(adminToken)).send({ note: 'Found it' });

    const mine = await api().get('/api/approvals/mine').set(auth(employeeToken));
    const asAdmin = await api().get('/api/approvals/mine').set(auth(adminToken));

    expect(mine.body.data.map((item: { type: string }) => item.type)).toEqual(['count', 'write_off', 'return']);
    expect(mine.body.data[1]).toMatchObject({ status: 'rejected', decisionNote: 'Found it', summary: '1 × Oak Chair (lost)' });
    expect(mine.body.data[2]).toMatchObject({ status: 'pending', summary: 'Return of 8 × Oak Chair, refund €80.00' });
    expect(mine.body.data[0]).toMatchObject({ status: 'submitted', summary: 'Stock count of the whole shop' });
    expect(asAdmin.body.data).toEqual([]);
  });
});
