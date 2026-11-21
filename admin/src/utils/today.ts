import { useEffect, useState } from 'react';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The time now, moved on every minute and whenever the page comes back into
 * view, so a page left open overnight shows the new day, not the one it was opened on.
 */
export function useNow(every = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const onShow = () => {
      if (document.visibilityState === 'visible') tick();
    };
    const timer = window.setInterval(tick, every);
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', tick);
    };
  }, [every]);
  return now;
}

/** Local midnight at the start of a moment's day. */
export const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * A day so far (up to `now`, or the whole day once it is over), against the
 * same hours of the same weekday a week before.
 */
export function dayRange(midnight: Date, now = new Date()) {
  const next = new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() + 1);
  const end = now < next ? now : next;
  const weekAgo = (date: Date) => new Date(date.getTime() - 7 * MS_PER_DAY).toISOString();
  return {
    startDate: midnight.toISOString(),
    endDate: end.toISOString(),
    previousStartDate: weekAgo(midnight),
    previousEndDate: weekAgo(end),
  };
}
