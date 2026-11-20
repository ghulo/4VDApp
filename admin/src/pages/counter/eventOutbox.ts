/*
 * What happened at the Counter besides sales (a line taken off, a basket
 * cancelled, a receipt that didn't print), written to this PC first and then
 * sent in order, so nothing is lost when the internet or the server is down.
 *
 * - Per business and cashier: the server records each event for whoever is
 *   signed in, in the business the session works in.
 * - Each event has its own id and the time it happened: the server keeps an
 *   id once, so an event sent twice (the answer got lost) is recorded once,
 *   and a basket cancelled at 23:58 counts on that day.
 * - At most 50 go in one request (the server's limit). One the server refuses
 *   as wrong (400) stays, with why, and is not sent again; the rest carry on.
 *   Any other trouble (no internet, signed out, server down, too many
 *   requests) stops the sending and keeps everything for the next try.
 */

import { ApiError } from '../../services/apiClient';
import type { CounterEventInput } from '../../services/types';

/** The server takes at most this many events in one request. */
export const BATCH = 50;
/** Plenty for days without internet; past this the oldest go (refused ones first), so storage never fills. */
export const MAX_KEPT = 1000;

export interface OutboxEntry {
  id: string;
  /** When it happened (ISO). */
  at: string;
  event: CounterEventInput;
  /** The server refused it: why. It stays for the owner to see, and is not sent again. */
  refused?: string;
}

/** Whose events these are: one business, one cashier. */
export interface Owner {
  businessId: number;
  userId: number;
}

export interface EventStore {
  read(owner: Owner): OutboxEntry[];
  write(owner: Owner, entries: OutboxEntry[]): void;
}

const keyOf = (owner: Owner) => `4vd.counter.events.${owner.businessId}.${owner.userId}`;

export const localEventStore: EventStore = {
  read(owner) {
    try {
      const saved = JSON.parse(localStorage.getItem(keyOf(owner)) ?? '[]') as unknown;
      return Array.isArray(saved) ? (saved as OutboxEntry[]) : [];
    } catch {
      return [];
    }
  },
  write(owner, entries) {
    try {
      if (entries.length === 0) localStorage.removeItem(keyOf(owner));
      else localStorage.setItem(keyOf(owner), JSON.stringify(entries));
    } catch {
      // Blocked or full storage: what is in memory still goes out this time.
    }
  },
};

/** An event as the server takes it: the event, its id and when it happened. */
export type SentEvent = CounterEventInput & { clientId: string; at: string };

/** Write events down first; nothing is sent here (see `drain`). */
export function keep(store: EventStore, owner: Owner, events: CounterEventInput[], now = new Date(), makeId: () => string = () => crypto.randomUUID()): void {
  if (events.length === 0) return;
  const entries: OutboxEntry[] = events.map((event) => ({ id: makeId(), at: now.toISOString(), event }));
  store.write(owner, trimmed([...store.read(owner), ...entries]));
}

/** Over the cap: the oldest refused ones go first, then the oldest waiting; the order stays. */
function trimmed(all: OutboxEntry[]): OutboxEntry[] {
  let over = all.length - MAX_KEPT;
  if (over <= 0) return all;
  const dropped = new Set<OutboxEntry>();
  for (const pass of [(entry: OutboxEntry) => Boolean(entry.refused), () => true]) {
    for (const entry of all) {
      if (over === 0) break;
      if (dropped.has(entry) || !pass(entry)) continue;
      dropped.add(entry);
      over -= 1;
    }
  }
  return all.filter((entry) => !dropped.has(entry));
}

/** The server read the event and said it is wrong: sending it again won't change that. */
const isRefusal = (error: unknown) => error instanceof ApiError && (error.status === 400 || error.status === 422);

/** How many wait to be sent (refused ones don't count). */
export const waitingCount = (store: EventStore, owner: Owner) => store.read(owner).filter((entry) => !entry.refused).length;

/** The ones the server refused, oldest first, for the owner to see. */
export const refusedEntries = (store: EventStore, owner: Owner) => store.read(owner).filter((entry) => entry.refused);

/** Try the refused ones again (the cause was fixed: a clock set right, a product back). */
export function unrefuse(store: EventStore, owner: Owner): void {
  store.write(owner, store.read(owner).map(({ refused: _was, ...entry }) => entry));
}

const running = new Map<string, Promise<void>>();

/**
 * Send what waits, oldest first, 50 at a time; one at a time per owner (a
 * second call waits for the first). A batch the server confirms is removed;
 * a network failure stops (all stay); a refused batch is tried one by one so
 * only the event at fault is marked refused. `stillOwner` is asked before
 * every request: once another person or business is signed in, the rest
 * waits for its own owner (the request would go out as the new one).
 */
export function drain(store: EventStore, owner: Owner, send: (events: SentEvent[]) => Promise<unknown>, stillOwner: () => boolean = () => true): Promise<void> {
  const key = keyOf(owner);
  const before = running.get(key) ?? Promise.resolve();
  const next = before.then(() => drainNow(store, owner, send, stillOwner));
  const settled = next.catch(() => undefined);
  running.set(key, settled);
  void settled.then(() => {
    if (running.get(key) === settled) running.delete(key);
  });
  return next;
}

const toSent = (entry: OutboxEntry): SentEvent => ({ ...entry.event, clientId: entry.id, at: entry.at });

function remove(store: EventStore, owner: Owner, ids: Set<string>) {
  store.write(owner, store.read(owner).filter((entry) => !ids.has(entry.id)));
}

function markRefused(store: EventStore, owner: Owner, id: string, why: string) {
  store.write(owner, store.read(owner).map((entry) => (entry.id === id ? { ...entry, refused: why } : entry)));
}

async function drainNow(store: EventStore, owner: Owner, send: (events: SentEvent[]) => Promise<unknown>, stillOwner: () => boolean): Promise<void> {
  for (;;) {
    const batch = store.read(owner).filter((entry) => !entry.refused).slice(0, BATCH);
    if (batch.length === 0 || !stillOwner()) return;
    try {
      await send(batch.map(toSent));
      remove(store, owner, new Set(batch.map((entry) => entry.id)));
      continue;
    } catch (error) {
      if (!isRefusal(error)) return;
      if (batch.length === 1) {
        markRefused(store, owner, batch[0]!.id, error instanceof Error ? error.message : String(error));
        continue;
      }
    }
    // Refused as a whole: one by one, so the good ones go and only the bad one stays.
    for (const entry of batch) {
      if (!stillOwner()) return;
      try {
        await send([toSent(entry)]);
        remove(store, owner, new Set([entry.id]));
      } catch (error) {
        if (!isRefusal(error)) return;
        markRefused(store, owner, entry.id, error instanceof Error ? error.message : String(error));
      }
    }
  }
}
