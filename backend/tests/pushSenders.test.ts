import { describe, expect, it } from 'vitest';
import { ExpoPushSender, type PushMessage } from '../src/services/push/senders.js';

const message = (token: string): PushMessage => ({
  token,
  keys: null,
  title: 'Low stock: Oak Chair',
  body: '2 left',
  data: { type: 'low_stock', notificationId: 1 },
});

describe('Expo push sender', () => {
  it('should send in one request and report devices Expo no longer knows', async () => {
    const requests: unknown[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          data: [{ status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }],
        }),
      );
    }) as typeof fetch;

    const result = await new ExpoPushSender(fakeFetch).send([message('ExponentPushToken[a]'), message('ExponentPushToken[b]')]);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual([
      expect.objectContaining({ to: 'ExponentPushToken[a]', title: 'Low stock: Oak Chair' }),
      expect.objectContaining({ to: 'ExponentPushToken[b]' }),
    ]);
    expect(result.deadTokens).toEqual(['ExponentPushToken[b]']);
  });

  it('should not throw when Expo is unreachable', async () => {
    const failingFetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;

    await expect(new ExpoPushSender(failingFetch).send([message('ExponentPushToken[a]')])).resolves.toEqual({ deadTokens: [] });
  });
});
