import { describe, expect, it } from 'vitest';
import { ApiError } from '../../services/apiClient';
import type { CounterEventInput } from '../../services/types';
import { drain, type EventStore, keep, MAX_KEPT, type Owner, type OutboxEntry, type SentEvent, waitingCount } from './eventOutbox';

function memoryStore(): EventStore {
  const saved = new Map<string, OutboxEntry[]>();
  const key = (owner: Owner) => `${owner.businessId}.${owner.userId}`;
  return { read: (owner) => saved.get(key(owner)) ?? [], write: (owner, entries) => void saved.set(key(owner), entries) };
}

const me: Owner = { businessId: 1, userId: 4 };
const removed = (amount: number): CounterEventInput => ({ kind: 'line_removed', productId: 7, quantity: 1, amount, reason: 'Scanned twice' });
let counter = 0;
const ids = () => `id-${++counter}`;
const offline = () => Promise.reject(new TypeError('Failed to fetch'));

describe('Counter events, written down first and sent in order', () => {
  it('keeps every event with its own id and the time it happened, per business and cashier', () => {
    const store = memoryStore();
    keep(store, me, [removed(1)], new Date('2026-11-20T22:58:00Z'), ids);
    expect(store.read(me)).toEqual([{ id: expect.any(String), at: '2026-11-20T22:58:00.000Z', event: removed(1) }]);
    expect(store.read({ businessId: 2, userId: 4 })).toEqual([]);
    expect(store.read({ businessId: 1, userId: 5 })).toEqual([]);
  });

  it('keeps everything when the server can’t be reached, and sends it in order later', async () => {
    const store = memoryStore();
    keep(store, me, [removed(1), removed(2)], new Date(), ids);
    await drain(store, me, offline);
    expect(waitingCount(store, me)).toBe(2);
    const sent: SentEvent[][] = [];
    await drain(store, me, async (events) => void sent.push(events));
    expect(sent.flat().map((event) => 'amount' in event && event.amount)).toEqual([1, 2]);
    expect(sent.flat().every((event) => event.clientId && event.at)).toBe(true);
    expect(store.read(me)).toEqual([]);
  });

  it('sends more than 50 in batches of at most 50', async () => {
    const store = memoryStore();
    keep(store, me, Array.from({ length: 120 }, (_, index) => removed(index)), new Date(), ids);
    const sizes: number[] = [];
    await drain(store, me, async (events) => void sizes.push(events.length));
    expect(sizes).toEqual([50, 50, 20]);
    expect(store.read(me)).toEqual([]);
  });

  it('keeps only the one the server refuses, with why, and sends the rest', async () => {
    const store = memoryStore();
    keep(store, me, [removed(1), removed(-5), removed(3)], new Date(), ids);
    const recorded: number[] = [];
    await drain(store, me, async (events) => {
      if (events.some((event) => 'amount' in event && event.amount < 0)) throw new ApiError('amount must be at least 0', 400, null);
      recorded.push(...events.map((event) => ('amount' in event ? event.amount : 0)));
    });
    expect(recorded).toEqual([1, 3]);
    expect(store.read(me)).toEqual([expect.objectContaining({ event: removed(-5), refused: 'amount must be at least 0' })]);
    expect(waitingCount(store, me)).toBe(0);
    // A refused one is not sent again.
    let calls = 0;
    await drain(store, me, async () => void calls++);
    expect(calls).toBe(0);
  });

  it('stops at a network failure part-way and keeps what wasn’t confirmed', async () => {
    const store = memoryStore();
    keep(store, me, Array.from({ length: 60 }, (_, index) => removed(index)), new Date(), ids);
    let calls = 0;
    await drain(store, me, async () => {
      calls += 1;
      if (calls === 2) throw new ApiError('down', 503, null);
    });
    expect(waitingCount(store, me)).toBe(10);
  });

  it('runs one sender at a time, so nothing is sent twice', async () => {
    const store = memoryStore();
    keep(store, me, [removed(1)], new Date(), ids);
    const sent: string[] = [];
    const slow = async (events: SentEvent[]) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      sent.push(...events.map((event) => event.clientId));
    };
    await Promise.all([drain(store, me, slow), drain(store, me, slow)]);
    expect(sent).toHaveLength(1);
  });
  it('keeps everything, unrefused, when the server is down, the session ran out or there were too many requests', async () => {
    for (const status of [401, 403, 429, 500]) {
      const store = memoryStore();
      keep(store, me, Array.from({ length: 60 }, (_, index) => removed(index)), new Date(), ids);
      await drain(store, me, () => Promise.reject(new ApiError('no', status, null)));
      expect(waitingCount(store, me)).toBe(60);
      expect(store.read(me).some((entry) => entry.refused)).toBe(false);
    }
  });

  it('past the cap, lets the oldest go (refused ones first), never the newest', () => {
    const store = memoryStore();
    store.write(me, [{ id: 'bad', at: '2026-11-01T00:00:00.000Z', event: removed(-1), refused: 'no' }]);
    keep(store, me, Array.from({ length: MAX_KEPT }, (_, index) => removed(index)), new Date(), ids);
    keep(store, me, [removed(9999)], new Date(), ids);
    const kept = store.read(me);
    expect(kept).toHaveLength(MAX_KEPT);
    expect(kept.some((entry) => entry.refused)).toBe(false);
    expect(kept.at(-1)?.event).toEqual(removed(9999));
    expect(kept[0]?.event).toEqual(removed(1));
  });
});
