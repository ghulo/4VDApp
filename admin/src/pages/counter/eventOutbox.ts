/*
 * What happened at the Counter besides sales (a line taken off, a basket
 * cancelled, a receipt that didn't print), kept on this PC while the server
 * can't be reached and sent once it can. Per person, because the server
 * records each event as whoever is signed in when it arrives.
 */

import type { CounterEventInput } from '../../services/types';
import { isNetworkFailure } from './offlineQueue';

/** Plenty for a day without internet; past this the oldest go, so storage never fills. */
const MAX_KEPT = 500;

export interface EventStore {
  read(userId: number): CounterEventInput[];
  write(userId: number, events: CounterEventInput[]): void;
}

const keyOf = (userId: number) => `4vd.counter.events.${userId}`;

export const localEventStore: EventStore = {
  read(userId) {
    try {
      const saved = JSON.parse(localStorage.getItem(keyOf(userId)) ?? '[]') as unknown;
      return Array.isArray(saved) ? (saved as CounterEventInput[]) : [];
    } catch {
      return [];
    }
  },
  write(userId, events) {
    try {
      if (events.length === 0) localStorage.removeItem(keyOf(userId));
      else localStorage.setItem(keyOf(userId), JSON.stringify(events));
    } catch {
      // Blocked storage: the event is lost, the till carries on.
    }
  },
};

/** Send events; when the server can't be reached they wait on this PC. Any other refusal drops them (sending again wouldn't help). */
export async function sendEvents(store: EventStore, userId: number, events: CounterEventInput[], send: (events: CounterEventInput[]) => Promise<unknown>): Promise<void> {
  if (events.length === 0) return;
  try {
    await send(events);
  } catch (error) {
    if (isNetworkFailure(error)) store.write(userId, [...store.read(userId), ...events].slice(-MAX_KEPT));
  }
}

/** Send what waits for this person; what still can't go stays. */
export async function flushEvents(store: EventStore, userId: number, send: (events: CounterEventInput[]) => Promise<unknown>): Promise<void> {
  const kept = store.read(userId);
  if (kept.length === 0) return;
  store.write(userId, []);
  await sendEvents(store, userId, kept, send);
}
