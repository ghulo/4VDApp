import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AiUnavailableError } from '../src/errors/httpErrors.js';
import { type AiProvider, GeminiProvider } from '../src/services/ai/aiProvider.js';
import { NameMasker } from '../src/services/ai/nameMasker.js';
import { createTestProduct, createTestUser, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

interface FakeAi extends AiProvider {
  lastRequest: string;
  reply: string;
  failWith: Error | null;
}

/** Remembers what it was sent and answers with whatever the test sets. */
const fakeAi: FakeAi = {
  name: 'Fake AI',
  lastRequest: '',
  reply: 'Person 1 sold the most.',
  failWith: null,
  async generate({ request }: { instructions: string; request: string }) {
    fakeAi.lastRequest = request;
    if (fakeAi.failWith) throw fakeAi.failWith;
    return fakeAi.reply;
  },
};

let context: TestContext;
let adminToken: string;

beforeAll(async () => {
  context = await setupTestApp({ aiProvider: fakeAi });
});
beforeEach(async () => {
  await resetData(context.db);
  fakeAi.failWith = null;
  adminToken = await loginAs(context, 'admin');
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const ask = (question: string, token = adminToken) =>
  request(context.app).post('/api/assistant/ask').set(auth(token)).send({ question });

describe('assistant', () => {
  it('should answer from the shop’s data without sending staff names', async () => {
    const productId = await createTestProduct(context, adminToken, { name: 'Oak Chair', stock: 50 });
    const seller = await createTestUser(context.db, 'employee', { email: 'ana@test.local' });
    await context.db.updateTable('users').set({ name: 'Ana Kovač' }).where('id', '=', seller.id).execute();
    const sellerLogin = await request(context.app).post('/api/auth/login').send({ email: 'ana@test.local', password: 'correct-horse-battery' });
    await request(context.app).post('/api/sales').set(auth(sellerLogin.body.data.token)).send({ productId, quantity: 3 });

    const response = await ask('Who sold the most this month?');

    expect(response.status).toBe(200);
    expect(fakeAi.lastRequest).toContain('Oak Chair');
    expect(fakeAi.lastRequest).toContain('Who sold the most this month?');
    expect(fakeAi.lastRequest).not.toContain('Ana');
    expect(response.body.data.answer).toBe('Ana Kovač sold the most.');
  });

  it('should explain when the AI service is unavailable', async () => {
    fakeAi.failWith = new AiUnavailableError("The AI service's free limit is used up for now. Try again later.");

    const response = await ask('How are sales?');

    expect(response.status).toBe(503);
    expect(response.body.message).toContain('free limit');
  });

  it('should be for admins, and need a real question', async () => {
    const employeeToken = await loginAs(context, 'employee');

    expect((await ask('How are sales?', employeeToken)).status).toBe(403);
    expect((await ask('')).status).toBe(400);
  });

  it('should say whether it is switched on', async () => {
    const response = await request(context.app).get('/api/assistant').set(auth(adminToken));

    expect(response.body.data).toEqual({ enabled: true, provider: 'Fake AI' });
  });
});

describe('NameMasker', () => {
  it('should not mix up Person 1 and Person 12', () => {
    const masker = new NameMasker();
    for (let index = 1; index <= 12; index++) masker.mask(`Name ${index}`);

    expect(masker.unmask('Person 12 beat Person 1.')).toBe('Name 12 beat Name 1.');
    expect(masker.maskKnown('Sale #4 by Name 12')).toBe('Sale #4 by Person 12');
  });
});

describe('GeminiProvider', () => {
  it('should send the key in a header and read the answer', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'About €200.' }] } }] }));
    }) as typeof fetch;

    const answer = await new GeminiProvider('secret-key', 'gemini-3.5-flash', fakeFetch).generate({ instructions: 'Be brief', request: 'Sales?' });

    expect(answer).toBe('About €200.');
    expect(seen!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent');
    expect(seen!.url).not.toContain('secret-key');
    expect((seen!.init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key');
  });

  it('should pass on Google’s reason for refusing', async () => {
    const refused = (async () =>
      new Response(JSON.stringify({ error: { message: 'Gemini API free tier is not available in your country.' } }), { status: 400 })) as typeof fetch;

    await expect(new GeminiProvider('key', 'model', refused).generate({ instructions: '', request: '' })).rejects.toThrow(
      'not available in your country',
    );
  });

  it('should turn a used-up free quota into a clear message', async () => {
    const limited = (async () => new Response('{}', { status: 429 })) as typeof fetch;

    await expect(new GeminiProvider('key', 'model', limited).generate({ instructions: '', request: '' })).rejects.toThrow('free limit');
  });
});
