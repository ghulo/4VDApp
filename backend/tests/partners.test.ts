import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../src/database/books.js';
import { BooksPoster } from '../src/services/books/BooksPoster.js';
import type { PartnerReader, PartnerReading, PartnerSource } from '../src/services/ai/partnerReader.js';
import { createTestProduct, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';
import { shopTimeZone } from '../src/validators/operationsValidators.js';

let context: TestContext;
let adminToken: string;
let employeeToken: string;
let productId: number;
const read: PartnerSource[] = [];

const reading: PartnerReading = {
  name: 'Ndërtimi SH.P.K.',
  kind: 'business',
  nui: '81 123 4567',
  fiscalNo: '',
  vatNo: '330-111-222',
  businessNo: '',
  address: 'Rr. Dardania 12',
  city: 'Prishtinë',
  phone: '038 222 333',
  mobile: '',
  email: '',
  iban: 'XK05 1212 0123 4567 8906',
  contactPerson: 'Agim Krasniqi',
};
const reader: PartnerReader = {
  read: async (source) => {
    read.push(source);
    return reading;
  },
};

beforeAll(async () => {
  context = await setupTestApp({ partnerReader: reader });
});
beforeEach(async () => {
  await resetData(context.db);
  await seedBooks(context.db as never);
  adminToken = await loginAs(context, 'admin');
  employeeToken = await loginAs(context, 'employee');
  productId = await createTestProduct(context, adminToken, { price: 100, costPrice: 60, stock: 50, vatRate: 18 });
  read.length = 0;
});
afterAll(() => context.db.destroy());

const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
const api = () => request(context.app);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });
const NUI = '811234567';

async function customer(body: Record<string, unknown> = {}): Promise<number> {
  const response = await api().post('/api/customers').set(auth()).send({ name: 'Ndërtimi', kind: 'business', nui: NUI, payLater: true, ...body });
  expect(response.status).toBe(201);
  return response.body.data.id;
}
async function supplier(nui = NUI): Promise<number> {
  const response = await api().post('/api/suppliers').set(auth()).send({ name: 'Ndërtimi', nui });
  expect(response.status).toBe(201);
  return response.body.data.id;
}
async function sellOnTab(customerId: number, quantity: number) {
  const response = await api().post('/api/sales/basket').set(auth()).send({ items: [{ productId, quantity }], notes: null, customerId, paidNow: false });
  expect(response.status).toBe(201);
}
async function bill(supplierId: number, amount: number, number: string) {
  const response = await api().post('/api/bills').set(auth()).send({ supplierId, number, issuedOn: today(), dueOn: today(), amount });
  expect(response.status).toBe(201);
  return response.body.data.id as number;
}
async function shopTill(): Promise<number> {
  const places = (await api().get('/api/money/places').set(auth())).body.data as Array<{ kind: string; carwashId: number | null; balance: number }>;
  return places.find((place) => place.kind === 'till' && place.carwashId === null)!.balance;
}

describe('filling a new firm in', () => {
  it('finds customers and suppliers by NUI digits or name', async () => {
    await customer();
    await supplier();
    await api().post('/api/suppliers').set(auth()).send({ name: 'Fresh Foods', nui: '811999999' });

    const byNui = (await api().get('/api/partners/lookup?nui=81 12').set(auth(employeeToken))).body.data;
    expect(byNui.map((match: { side: string }) => match.side).sort()).toEqual(['customer', 'supplier']);
    const byName = (await api().get('/api/partners/lookup?q=fresh').set(auth())).body.data;
    expect(byName).toEqual([expect.objectContaining({ side: 'supplier', name: 'Fresh Foods', nui: '811999999' })]);
    expect((await api().get('/api/partners/lookup?q=f').set(auth())).body.data).toEqual([]);
  });

  it('reads pasted text or a photo, keeping only digits in the numbers', async () => {
    const response = await api().post('/api/partners/read').set(auth(employeeToken)).send({ side: 'customer', text: 'Emri i biznesit: Ndërtimi SH.P.K.' });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ name: 'Ndërtimi SH.P.K.', nui: NUI, vatNo: '330111222', iban: 'XK051212012345678906' });
    expect(read[0]).toMatchObject({ side: 'customer', text: 'Emri i biznesit: Ndërtimi SH.P.K.' });

    const photo = await api()
      .post('/api/partners/read')
      .set(auth())
      .send({ side: 'supplier', pages: [{ mime: 'image/jpeg', data: Buffer.from('jpeg').toString('base64') }] });
    expect(photo.status).toBe(200);
    expect(read[1]!.pages![0]!.bytes.toString()).toBe('jpeg');

    expect((await api().post('/api/partners/read').set(auth()).send({ side: 'customer', text: '  ' })).status).toBe(400);
  });
});

describe('addresses', () => {
  it('keeps more addresses for a customer; the counter adds, managers change and remove', async () => {
    const id = await customer();
    const added = await api().post(`/api/partners/customers/${id}/addresses`).set(auth(employeeToken)).send({ label: 'Site', address: 'Rr. B 4', city: 'Fushë Kosovë' });
    expect(added.status).toBe(201);
    expect((await api().put(`/api/partners/addresses/${added.body.data.id}`).set(auth(employeeToken)).send({ label: 'Site', address: 'x' })).status).toBe(403);
    const saved = await api().put(`/api/partners/addresses/${added.body.data.id}`).set(auth()).send({ label: 'Site 2', address: 'Rr. B 6', city: null, note: 'Gate at the back' });
    expect(saved.body.data).toEqual({ id: added.body.data.id, label: 'Site 2', address: 'Rr. B 6', city: null, note: 'Gate at the back' });
    expect((await api().get(`/api/partners/customers/${id}/addresses`).set(auth(employeeToken))).body.data).toHaveLength(1);

    const supplierId = await supplier();
    await api().post(`/api/partners/suppliers/${supplierId}/addresses`).set(auth()).send({ label: 'Depo', address: 'Rr. C 1' });
    expect((await api().get(`/api/partners/suppliers/${supplierId}/addresses`).set(auth())).body.data).toHaveLength(1);

    expect((await api().delete(`/api/partners/addresses/${added.body.data.id}`).set(auth())).status).toBe(200);
    expect((await api().get(`/api/partners/customers/${id}/addresses`).set(auth())).body.data).toEqual([]);
  });
});

describe('a firm on both lists', () => {
  it('sets what they owe on their tab off against their bills, oldest first, with no money moving', async () => {
    const customerId = await customer();
    await sellOnTab(customerId, 3); // they owe €300
    const supplierId = await supplier('81 123 4567');
    const first = await bill(supplierId, 120, 'N-1');
    const second = await bill(supplierId, 100, 'N-2');

    const link = (await api().get(`/api/partners/link?customerId=${customerId}`).set(auth())).body.data;
    expect(link).toMatchObject({ supplier: { id: supplierId }, owesYou: 300, youOwe: 220, canOffset: 220 });
    expect((await api().get(`/api/partners/link?supplierId=${supplierId}`).set(auth())).body.data.customer.id).toBe(customerId);

    const till = await shopTill();
    expect((await api().post(`/api/partners/customers/${customerId}/offset`).set(auth()).send({ amount: 250 })).status).toBe(400);
    expect((await api().post(`/api/partners/customers/${customerId}/offset`).set(auth(employeeToken)).send({})).status).toBe(403);
    const done = await api().post(`/api/partners/customers/${customerId}/offset`).set(auth()).send({ amount: 150, note: 'Agreed by phone' });
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ owesYou: 150, youOwe: 70, canOffset: 70, offsets: [{ amount: 150, note: 'Agreed by phone' }] });

    const bills = (await api().get(`/api/bills?supplierId=${supplierId}`).set(auth())).body.data as Array<{ id: number; left: number }>;
    expect(bills.find((one) => one.id === first)!.left).toBe(0);
    expect(bills.find((one) => one.id === second)!.left).toBe(70);
    expect(await shopTill()).toBe(till);

    const entries = (await api().get(`/api/books/entries?source=offset&id=${done.body.data.offsets[0].id}`).set(auth())).body.data;
    const lines = entries[0].lines.map((line: { accountNumber: string; debit: number; credit: number }) => `${line.accountNumber} ${line.debit || -line.credit}`).sort();
    expect(lines).toEqual(['1230 -150', '2000 150']);
    // A rebuild of the books posts it again.
    await new BooksPoster(context.db, shopTimeZone()).rebuild();
    expect((await api().get(`/api/books/entries?source=offset&id=${done.body.data.offsets[0].id}`).set(auth())).body.data).toHaveLength(1);
    // The bill payments the offset made post nothing of their own.
    const payment = await context.db.selectFrom('supplier_payments').select('id').where('bill_id', '=', first).executeTakeFirstOrThrow();
    expect((await api().get(`/api/books/entries?source=payment&id=${payment.id}`).set(auth())).body.data).toEqual([]);
  });

  it('refuses when the NUI matches no supplier', async () => {
    const customerId = await customer();
    await supplier('811000000');
    const response = await api().post(`/api/partners/customers/${customerId}/offset`).set(auth()).send({});
    expect(response.status).toBe(400);
    expect(response.body.message).toContain("isn't on the suppliers list");
  });
});

describe('customer bonus', () => {
  it('earns a percent of the year’s purchases and pays it once, as a credit on their tab', async () => {
    const customerId = await customer({ bonusPercent: 2 });
    await sellOnTab(customerId, 5); // €500 bought
    const year = Number(today().slice(0, 4));

    const bonus = (await api().get(`/api/partners/customers/${customerId}/bonus`).set(auth())).body.data;
    expect(bonus.percent).toBe(2);
    expect(bonus.years[0]).toEqual({ year, bought: 500, earned: 10, paid: null, canPay: true });

    const paid = await api().post(`/api/partners/customers/${customerId}/bonus/${year}/pay`).set(auth());
    expect(paid.status).toBe(200);
    expect(paid.body.data.years[0]).toMatchObject({ earned: 10, paid: { amount: 10 }, canPay: false });
    expect((await api().post(`/api/partners/customers/${customerId}/bonus/${year}/pay`).set(auth())).status).toBe(409);

    const detail = (await api().get(`/api/customers/${customerId}`).set(auth())).body.data;
    expect(detail.balance).toBe(490);
    expect(detail.bonusPercent).toBe(2);
    const payout = await context.db.selectFrom('bonus_payouts').select('id').executeTakeFirstOrThrow();
    const entries = (await api().get(`/api/books/entries?source=bonus&id=${payout.id}`).set(auth())).body.data;
    const lines = entries[0].lines.map((line: { accountNumber: string; debit: number; credit: number }) => `${line.accountNumber} ${line.debit || -line.credit}`).sort();
    expect(lines).toEqual(['1230 -10', '4200 10']);
    // A rebuild of the books posts it again.
    await new BooksPoster(context.db, shopTimeZone()).rebuild();
    expect((await api().get(`/api/books/entries?source=bonus&id=${payout.id}`).set(auth())).body.data).toHaveLength(1);
  });

  it('lets only the owner’s side set the bonus', async () => {
    const created = await api().post('/api/customers').set(auth(employeeToken)).send({ name: 'Arben', bonusPercent: 5 });
    expect(created.body.data.bonusPercent).toBeNull();
    expect((await api().put(`/api/customers/${created.body.data.id}`).set(auth()).send({ name: 'Arben', bonusPercent: 60 })).status).toBe(400);
  });
});
