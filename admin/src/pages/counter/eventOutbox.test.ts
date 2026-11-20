import { describe, expect, it } from 'vitest';
import { ApiError } from '../../services/apiClient';
import type { CounterEventInput } from '../../services/types';
import { type EventStore, flushEvents, sendEvents } from './eventOutbox';

function memoryStore(): EventStore & { saved: Map<number, CounterEventInput[]> } {
  const saved = new Map<number, CounterEventInput[]>();
  return { saved, read: (userId) => saved.get(userId) ?? [], write: (userId, events) => void saved.set(userId, events) };
}

const removed: CounterEventInput = { kind: 'line_removed', productId: 7, quantity: 1, amount: 2.5, reason: 'Scanned twice' };
const cancelled: CounterEventInput = { kind: 'basket_cancelled', quantity: 3, amount: 9, reason: 'Left without paying' };

describe('Counter events without internet', () => {
  it('keeps an event that could not reach the server, for that person', async () => {
    const store = memoryStore();
    await sendEvents(store, 4, [removed], () => Promise.reject(new TypeError('Failed to fetch')));
    expect(store.read(4)).toEqual([removed]);
    expect(store.read(5)).toEqual([]);
  });

  it('drops an event the server refused (sending it again would not help)', async () => {
    const store = memoryStore();
    await sendEvents(store, 4, [removed], () => Promise.reject(new ApiError('Bad', 400, null)));
    expect(store.read(4)).toEqual([]);
  });

  it('sends what waited once the server answers, and keeps it if it still can’t', async () => {
    const store = memoryStore();
    store.write(4, [removed]);
    await flushEvents(store, 4, () => Promise.reject(new ApiError('down', 503, null)));
    expect(store.read(4)).toEqual([removed]);
    const sent: CounterEventInput[][] = [];
    await sendEvents(store, 4, [cancelled], () => Promise.reject(new TypeError('offline')));
    await flushEvents(store, 4, async (events) => void sent.push(events));
    expect(sent).toEqual([[removed, cancelled]]);
    expect(store.read(4)).toEqual([]);
  });
});
