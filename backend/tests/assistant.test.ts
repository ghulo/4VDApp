import request from 'supertest';
import type { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AiUnavailableError } from '../src/errors/httpErrors.js';
import { type AiProvider, GeminiProvider } from '../src/services/ai/aiProvider.js';
import { NameMasker } from '../src/services/ai/nameMasker.js';
import { ClaudeProvider } from '../src/services/ai/claudeProvider.js';
import type Anthropic from '@anthropic-ai/sdk';
import { createTestProduct, createTestUser, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

interface FakeAi extends AiProvider {
  lastRequest: string;
  reply: string;
  /** What generateJson returns. */
  jsonReply: unknown;
  failWith: Error | null;
}

/** Remembers what it was sent and answers with whatever the test sets. */
const fakeAi: FakeAi = {
  name: 'Fake AI',
  lastRequest: '',
  reply: 'Person 1 sold the most.',
  jsonReply: null,
  failWith: null,
  async generate({ request }: { instructions: string; request: string }) {
    fakeAi.lastRequest = request;
    if (fakeAi.failWith) throw fakeAi.failWith;
    return fakeAi.reply;
  },
  async generateJson<T>({ request }: { instructions: string; request: string }, schema: z.ZodType<T>) {
    fakeAi.lastRequest = request;
    if (fakeAi.failWith) throw fakeAi.failWith;
    return schema.parse(fakeAi.jsonReply);
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
const ask = (question: string, token = adminToken, chatId?: number) =>
  request(context.app).post('/api/assistant/chats/messages').set(auth(token)).send({ question, chatId });
const answer = (text: string, extras: Record<string, unknown> = {}) => ({ text, ...extras });

describe('assistant', () => {
  it('should answer from the shop’s data without sending staff names', async () => {
    const productId = await createTestProduct(context, adminToken, { name: 'Oak Chair', stock: 50 });
    const seller = await createTestUser(context.db, 'employee', { email: 'ana@test.local' });
    await context.db.updateTable('users').set({ name: 'Ana Kovač' }).where('id', '=', seller.id).execute();
    const sellerLogin = await request(context.app).post('/api/auth/login').send({ email: 'ana@test.local', password: 'correct-horse-battery' });
    await request(context.app).post('/api/sales').set(auth(sellerLogin.body.data.token)).send({ productId, quantity: 3 });
    fakeAi.jsonReply = answer('Person 1 sold the most.', {
      tables: [{ title: 'Sellers', columns: ['Seller', 'Sales'], rows: [['Person 1', 3]] }],
    });

    const response = await ask('Who sold the most this month?');

    expect(response.status).toBe(200);
    expect(fakeAi.lastRequest).toContain('Oak Chair');
    expect(fakeAi.lastRequest).toContain('Who sold the most this month?');
    expect(fakeAi.lastRequest).not.toContain('Ana');
    const reply = response.body.data.messages[1];
    expect(reply.text).toBe('Ana Kovač sold the most.');
    expect(reply.extras.tables[0].rows[0]).toEqual(['Ana Kovač', 3]);
    expect(response.body.data.chat.title).toBe('Who sold the most this month?');
  });

  it('should keep a conversation: follow-ups carry the chat so far, and chats can be reopened and deleted', async () => {
    fakeAi.jsonReply = answer('Sales are up.');
    const first = (await ask('How are sales?')).body.data;

    fakeAi.jsonReply = answer('Last month was lower.');
    const second = await ask('And last month?', adminToken, first.chat.id);
    expect(second.status).toBe(200);
    expect(fakeAi.lastRequest).toContain('Owner: How are sales?');
    expect(fakeAi.lastRequest).toContain('You: Sales are up.');
    expect(second.body.data.chat.id).toBe(first.chat.id);

    const list = (await request(context.app).get('/api/assistant/chats').set(auth(adminToken))).body.data;
    expect(list).toHaveLength(1);
    const opened = (await request(context.app).get(`/api/assistant/chats/${first.chat.id}`).set(auth(adminToken))).body.data;
    expect(opened.messages.map((message: { text: string }) => message.text)).toEqual([
      'How are sales?',
      'Sales are up.',
      'And last month?',
      'Last month was lower.',
    ]);

    expect((await request(context.app).delete(`/api/assistant/chats/${first.chat.id}`).set(auth(adminToken))).status).toBe(200);
    expect((await request(context.app).get(`/api/assistant/chats/${first.chat.id}`).set(auth(adminToken))).status).toBe(404);
  });

  it("should keep each person's chats to themselves", async () => {
    fakeAi.jsonReply = answer('Fine.');
    const mine = (await ask('How are sales?')).body.data;
    const ownerToken = await loginAs(context, 'owner');

    expect((await request(context.app).get(`/api/assistant/chats/${mine.chat.id}`).set(auth(ownerToken))).status).toBe(404);
    expect((await ask('And today?', ownerToken, mine.chat.id)).status).toBe(404);
    expect((await request(context.app).delete(`/api/assistant/chats/${mine.chat.id}`).set(auth(ownerToken))).status).toBe(404);
    expect((await request(context.app).get('/api/assistant/chats').set(auth(ownerToken))).body.data).toEqual([]);
  });

  it('should keep only links to pages inside the app', async () => {
    fakeAi.jsonReply = answer('See these.', {
      links: [
        { label: 'Chair', to: '/inventory/12' },
        { label: 'Reports', to: '/reports' },
        { label: 'Evil', to: 'https://evil.example' },
        { label: 'Sneaky', to: '//evil.example' },
        { label: 'Settings', to: '/settings' },
      ],
    });

    const reply = (await ask('Where do I look?')).body.data.messages[1];

    expect(reply.extras.links.map((link: { to: string }) => link.to)).toEqual(['/inventory/12', '/reports']);
  });

  it('should save nothing when the AI fails', async () => {
    fakeAi.failWith = new AiUnavailableError('Down.');
    await ask('How are sales?');

    expect((await request(context.app).get('/api/assistant/chats').set(auth(adminToken))).body.data).toEqual([]);
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

describe('price suggestions', () => {
  const suggestion = (overrides: Record<string, unknown> = {}) => ({
    suggestedPrice: 109.9,
    decision: 'raise',
    confidence: 'medium',
    summary: 'It sells fast with room to go up.',
    reasons: ['Sells about 2 a day.', 'Similar chairs sell for 120.'],
    watchOut: 'Watch sales for two weeks.',
    ...overrides,
  });
  const suggest = (productId: number) =>
    request(context.app).post(`/api/assistant/price-suggestions/${productId}`).set(auth(adminToken));

  it('should suggest a price from the product’s own sales and similar products', async () => {
    const chair = await createTestProduct(context, adminToken, { name: 'Oak Chair', price: 100, costPrice: 60, stock: 50 });
    await createTestProduct(context, adminToken, { name: 'Pine Chair', price: 80, costPrice: 50, stock: 5 });
    await request(context.app).post('/api/sales').set(auth(adminToken)).send({ productId: chair, quantity: 2 });
    fakeAi.jsonReply = suggestion();

    const response = await suggest(chair);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ currentPrice: 100, costPrice: 60, suggestedPrice: 109.9, decision: 'raise', provider: 'Fake AI' });
    expect(fakeAi.lastRequest).toContain('Pine Chair');
    expect(fakeAi.lastRequest).toContain('"unitPrice":100');
  });

  it('should never suggest below cost plus the minimum margin', async () => {
    const chair = await createTestProduct(context, adminToken, { price: 100, costPrice: 60 });
    await request(context.app).put('/api/settings').set(auth(adminToken)).send({ minimumMarginPercent: 10 });
    fakeAi.jsonReply = suggestion({ suggestedPrice: 50, decision: 'lower' });

    const response = await suggest(chair);

    expect(response.body.data).toMatchObject({ suggestedPrice: 66, minimumPrice: 66, decision: 'lower' });
    expect(response.body.data.reasons.at(-1)).toContain('minimum price');
  });

  it('should answer 404 for a product that doesn’t exist', async () => {
    expect((await suggest(9999)).status).toBe(404);
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

describe('ClaudeProvider', () => {
  /** Stands in for the SDK client: records the request and returns `reply`. */
  const fakeClient = (reply: Record<string, unknown>) => {
    const seen: Record<string, unknown>[] = [];
    const client = { beta: { messages: { create: async (params: Record<string, unknown>) => (seen.push(params), reply) } } };
    return { client: client as unknown as Anthropic, seen };
  };

  it('should ask with the instructions as the system prompt and return the text', async () => {
    const { client, seen } = fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'About €200.' }] });

    const answer = await new ClaudeProvider('key', 'claude-opus-5-5', { client }).generate({ instructions: 'Be brief', request: 'Sales?' });

    expect(answer).toBe('About €200.');
    expect(seen[0]).toMatchObject({ model: 'claude-opus-5-5', system: 'Be brief', fallbacks: 'default', messages: [{ role: 'user', content: 'Sales?' }] });
  });

  it('should send Haiku a plain request, without effort or fallbacks', async () => {
    const { client, seen } = fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Fine.' }] });

    await new ClaudeProvider('key', 'claude-haiku-4-5', { client }).generate({ instructions: '', request: 'Hi' });

    expect(seen[0]).not.toHaveProperty('output_config');
    expect(seen[0]).not.toHaveProperty('fallbacks');
  });

  it('should turn a refusal into a readable message', async () => {
    const { client } = fakeClient({ stop_reason: 'refusal', stop_details: { category: null }, content: [] });

    await expect(new ClaudeProvider('key', 'model', { client }).generate({ instructions: '', request: '' })).rejects.toThrow('ask');
  });
});
