import { hashKey, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { type TillShelf, tillShelfKey } from '../pages/counter/shelfAfterSale';
import { currentIdentity, restoreTillCopy, saveTillCopy, tillCopyKeys } from './savedCopy';

/** How long after a change the copy is written: a burst of answers (the till starting) makes one write. */
const SAVE_AFTER_MS = 3_000;

/**
 * The Counter keeps a copy of what it needs to sell on this PC (savedCopy.ts),
 * written a moment after any of it changes and when the window is hidden or
 * closed. And when its shelf can't be fetched and it has none, it takes the
 * saved one: a start without internet still sells.
 */
export function useTillCopy(owner: { businessId: number; userId: number }, shelfFailed: boolean, hasShelf: boolean, onSaved: (shelf: TillShelf) => void): void {
  const client = useQueryClient();
  const { businessId, userId } = owner;
  const savedRef = useRef(onSaved);
  useEffect(() => {
    savedRef.current = onSaved;
  });

  useEffect(() => {
    if (businessId === 0) return;
    // Written only while this person is still the one signed in here: a write left over after a sign-out is dropped.
    const since = currentIdentity();
    const watched = new Set(tillCopyKeys(businessId).map((key) => hashKey(key)));
    const shelfHash = hashKey(tillShelfKey(businessId));
    // The shelf is written only when it changed here (fetched, or a sale taken off it), never because the customers did.
    let shelfChanges = 0;
    let shelfSaved = 0;
    let timer: number | undefined;
    const save = () => {
      window.clearTimeout(timer);
      timer = undefined;
      const upTo = shelfChanges;
      // Once the shelf is saved, the sales it counts may stop being held (never before: a crash in between would bring them back).
      void saveTillCopy(client, { businessId, userId }, since, upTo > shelfSaved)
        .then((shelf) => {
          shelfSaved = Math.max(shelfSaved, upTo);
          if (shelf) savedRef.current(shelf);
        })
        .catch(() => undefined);
    };
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success' || !watched.has(event.query.queryHash)) return;
      if (event.query.queryHash === shelfHash) shelfChanges += 1;
      window.clearTimeout(timer);
      timer = window.setTimeout(save, SAVE_AFTER_MS);
    });
    const onHide = () => {
      if (document.visibilityState === 'hidden' && timer !== undefined) save();
    };
    const onLeave = () => {
      if (timer !== undefined) save();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onLeave);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onLeave);
      if (timer !== undefined) save();
    };
  }, [client, businessId, userId]);

  useEffect(() => {
    if (businessId === 0 || hasShelf || !shelfFailed) return;
    void restoreTillCopy(client, { businessId, userId });
  }, [client, businessId, userId, shelfFailed, hasShelf]);
}
