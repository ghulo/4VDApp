import { useSyncExternalStore } from 'react';
import { useT } from '../../i18n/useT';
import { formatDate, formatTime } from '../../utils/format';

/**
 * One 10-second tick for the till, shared by what shows time (the clock, how
 * long each basket's customer has waited), so only those re-render on it and
 * the rest of the till doesn't.
 */
const listeners = new Set<() => void>();
let current = Date.now();
let timer: number | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === undefined) {
    current = Date.now();
    timer = window.setInterval(() => {
      current = Date.now();
      for (const one of listeners) one();
    }, 10_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

function useTillNow(): number {
  return useSyncExternalStore(subscribe, () => current);
}

/** The clock in the till's status bar. */
export function TillClock() {
  const now = useTillNow();
  const clock = new Date(now).toISOString();
  return (
    <time className="counter__clock" dateTime={clock} title={formatDate(clock)}>
      {formatTime(clock)}
    </time>
  );
}

/** A basket tab's line count and how long its customer has waited. */
export function BasketAge({ startedAt, lineCount }: { startedAt: number; lineCount: number }) {
  const t = useT();
  const now = useTillNow();
  const minutes = Math.max(0, Math.floor((now - startedAt) / 60_000));
  return <>{`${t.counter.basketLines(lineCount)} · ${t.counter.age(minutes)}`}</>;
}
