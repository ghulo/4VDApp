/**
 * A page's code that couldn't be fetched because the phone is offline (a
 * lazy page opened without internet). Reloading then only swaps 4VD for the
 * browser's own "No internet" page, so 4VD says so itself and waits.
 */
export function offlineLoadError(error: unknown, online = typeof navigator === 'undefined' ? true : navigator.onLine): boolean {
  if (online) return false;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return error instanceof TypeError || /dynamically imported module|module script|failed to fetch|load failed|preload/i.test(message);
}
