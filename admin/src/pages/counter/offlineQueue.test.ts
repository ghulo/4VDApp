import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../services/apiClient';
import { isNetworkFailure, queueFailure, type QueuedSale, type QueueStore, sendWaiting, withTimeout } from './offlineQueue';

function memoryStore(sales: QueuedSale[]): QueueStore & { sales: QueuedSale[] } {
  const store = {
    sales,
    read: () => store.sales,
    write: (next: QueuedSale[]) => {
      store.sales = next;
    },
  };
  return store;
}

const sale = (key: string, at: string, userId = 1): QueuedSale => ({
  key,
  at,
  userId,
  businessId: 1,
  body: { items: [{ productId: 1, quantity: 1 }], notes: null },
  total: 2,
  receipt: null,
});

describe('the offline queue', () => {
  it('should send the oldest first and keep nothing once sent', async () => {
    const store = memoryStore([sale('b', '2026-10-19T10:05:00Z'), sale('a', '2026-10-19T10:00:00Z')]);
    const order: string[] = [];
    const { sent, stoppedByNetwork } = await sendWaiting(store, async (one) => order.push(one.key));
    expect(order).toEqual(['a', 'b']);
    expect(sent).toHaveLength(2);
    expect(stoppedByNetwork).toBe(false);
    expect(store.sales).toEqual([]);
  });

  it('should stop at a network failure and keep the rest waiting', async () => {
    const store = memoryStore([sale('a', '2026-10-19T10:00:00Z'), sale('b', '2026-10-19T10:05:00Z')]);
    const result = await sendWaiting(store, async () => {
      throw new ApiError('no internet', 0, 'NETWORK');
    });
    expect(result.stoppedByNetwork).toBe(true);
    expect(store.sales.map((one) => one.key)).toEqual(['a', 'b']);
    expect(store.sales.every((one) => one.refused === undefined)).toBe(true);
  });

  it('should mark a sale the server refuses and go on with the next', async () => {
    const store = memoryStore([sale('a', '2026-10-19T10:00:00Z'), sale('b', '2026-10-19T10:05:00Z')]);
    const { sent } = await sendWaiting(store, async (one) => {
      if (one.key === 'a') throw new ApiError('The month is filed', 409, null);
      return one.key;
    });
    expect(sent.map((one) => one.result)).toEqual(['b']);
    expect(store.sales).toEqual([{ ...sale('a', '2026-10-19T10:00:00Z'), refused: 'The month is filed' }]);
  });

  it('should leave the sales it is told to skip', async () => {
    const store = memoryStore([sale('a', '2026-10-19T10:00:00Z', 2), sale('b', '2026-10-19T10:05:00Z')]);
    await sendWaiting(store, async () => undefined, (one) => one.userId !== 1);
    expect(store.sales.map((one) => one.key)).toEqual(['a']);
  });

  it('should tell network failures from refusals', () => {
    expect(isNetworkFailure(new ApiError('down', 0, 'NETWORK'))).toBe(true);
    expect(isNetworkFailure(new ApiError('gateway', 502, null))).toBe(true);
    expect(isNetworkFailure(new ApiError('bad', 400, null))).toBe(false);
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkFailure(new Error('bug'))).toBe(false);
  });

  it('should count a server that never answers as no internet, and stop the request', async () => {
    vi.useFakeTimers();
    let stopped: AbortSignal | undefined;
    const hanging = withTimeout((signal) => {
      stopped = signal;
      return new Promise(() => undefined);
    }, 12_000);
    expect(stopped?.aborted).toBe(false);
    vi.advanceTimersByTime(12_000);
    await expect(hanging).rejects.toSatisfy(isNetworkFailure);
    expect(stopped?.aborted).toBe(true);
    vi.useRealTimers();
    await expect(withTimeout(() => Promise.resolve('ok'), 50)).resolves.toBe('ok');
  });

  it('should stop the round, keeping the sale as it is, on an answer that says nothing about the sale', async () => {
    for (const answer of [new ApiError('someone else', 409, 'OWNER_CHANGED'), new ApiError('signed out', 401, 'UNAUTHORIZED'), new ApiError('slow down', 429, null), new ApiError('oops', 500, 'INTERNAL_ERROR'), new Error('bug')]) {
      const store = memoryStore([sale('a', '2026-10-19T10:00:00Z'), sale('b', '2026-10-19T10:05:00Z')]);
      const tried: string[] = [];
      const result = await sendWaiting(store, async (one) => {
        tried.push(one.key);
        throw answer;
      });
      expect(tried).toEqual(['a']);
      expect(result.sent).toEqual([]);
      expect(store.sales.every((one) => one.refused === undefined)).toBe(true);
      expect(queueFailure(answer)).toBe('wait');
    }
    expect(queueFailure(new ApiError('closed', 400, 'SALE_CLOSED'))).toBe('refused');
  });

  it('should never send by itself a sale kept without its business', async () => {
    const { businessId: _none, ...old } = sale('a', '2026-10-19T10:00:00Z');
    const store = memoryStore([old, sale('b', '2026-10-19T10:05:00Z')]);
    const tried: string[] = [];
    await sendWaiting(store, async (one) => tried.push(one.key));
    expect(tried).toEqual(['b']);
    expect(store.sales).toEqual([old]);
  });

  it('should ask again before each sale whether it may go, and hear of each sent one before it leaves the queue', async () => {
    const store = memoryStore([sale('a', '2026-10-19T10:00:00Z'), sale('b', '2026-10-19T10:05:00Z')]);
    let switched = false;
    const heard: Array<{ key: string; stillQueued: boolean }> = [];
    await sendWaiting(
      store,
      async () => {
        switched = true;
      },
      () => switched,
      (one) => heard.push({ key: one.key, stillQueued: store.sales.some((queued) => queued.key === one.key) }),
    );
    expect(heard).toEqual([{ key: 'a', stillQueued: true }]);
    expect(store.sales.map((one) => one.key)).toEqual(['b']);
  });
});
