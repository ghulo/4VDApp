import { useEffect, useSyncExternalStore } from 'react';

/**
 * The Motion setting (Settings → Display; DESIGN.md 12). Kept per device, in
 * localStorage, because the shop PC and a phone differ. It puts one word on
 * <html data-motion> that the CSS keys off (styles/motion.css):
 *   full     everything moves (Automatic gives this unless the device asks for less)
 *   reduced  short fades only: nothing slides, rolls or staggers
 *   off      every duration is 0; busy spinners still spin
 * public/boot.js applies the same rules before the first paint.
 */
export type MotionPreference = 'auto' | 'full' | 'reduced' | 'off';
export type MotionLevel = 'full' | 'reduced' | 'off';

export const MOTION_STORAGE_KEY = '4vd.motion';
export const MOTION_PREFERENCES: MotionPreference[] = ['auto', 'full', 'reduced', 'off'];
const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

/** Nothing saved: Automatic, except the Windows app on a PC with little memory (4 GB or less), which starts on Reduced. */
export function defaultPreference(desktop: boolean, deviceMemory: number | undefined): MotionPreference {
  return desktop && deviceMemory !== undefined && deviceMemory <= 4 ? 'reduced' : 'auto';
}

export function readMotionPreference(storage: Pick<Storage, 'getItem'> | null, fallback: MotionPreference): MotionPreference {
  try {
    const saved = storage?.getItem(MOTION_STORAGE_KEY);
    return MOTION_PREFERENCES.includes(saved as MotionPreference) ? (saved as MotionPreference) : fallback;
  } catch {
    return fallback;
  }
}

export function resolveMotion(preference: MotionPreference, systemReduce: boolean): MotionLevel {
  if (preference === 'auto') return systemReduce ? 'reduced' : 'full';
  return preference;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function systemReduces(): boolean {
  return window.matchMedia?.(REDUCE_QUERY).matches ?? false;
}

function deviceDefault(): MotionPreference {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return defaultPreference(Boolean(window.fourvdDesktop), memory);
}

const listeners = new Set<() => void>();
let current: MotionPreference | null = null;

function preference(): MotionPreference {
  current ??= readMotionPreference(storage(), deviceDefault());
  return current;
}

function paint(): void {
  document.documentElement.dataset.motion = resolveMotion(preference(), systemReduces());
}

/** How much moves on this device right now. Read it at the moment of moving, never once at load. */
export function motionLevel(): MotionLevel {
  if (typeof document === 'undefined') return 'off';
  const shown = document.documentElement.dataset.motion;
  return shown === 'full' || shown === 'reduced' || shown === 'off' ? shown : resolveMotion(preference(), systemReduces());
}

/** Applies the saved choice and follows the device's own setting live while it is Automatic. Once, from main.tsx. */
export function startMotion(): void {
  paint();
  window.matchMedia?.(REDUCE_QUERY).addEventListener?.('change', paint);
}

export function setMotionPreference(next: MotionPreference): void {
  current = next;
  try {
    storage()?.setItem(MOTION_STORAGE_KEY, next);
  } catch {
    // Blocked storage: the choice still applies for this visit.
  }
  paint();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The saved choice and a setter, for the setting itself. */
export function useMotionPreference(): [MotionPreference, (next: MotionPreference) => void] {
  return [useSyncExternalStore(subscribe, preference, () => 'auto' as const), setMotionPreference];
}

/**
 * Marks <html data-till> while the Counter is open, so nothing behind it
 * blurs (styles/glass.css): glass costs the shop PC's graphics on every frame.
 */
export function useTillMark(): void {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.till = '';
    return () => {
      delete root.dataset.till;
    };
  }, []);
}

/** A page's arrival: the main column fades up 6px from 0.6 (never from 0, so nothing waits on it). */
const ARRIVE: Keyframe[] = [
  { opacity: 0.6, transform: 'translateY(6px)' },
  { opacity: 1, transform: 'none' },
];

/**
 * Plays a page's arrival on the main column (SkipLink's route-change hook
 * calls it when the path changes, never on first load). Played on the
 * element, so the page never remounts. Only under 'full'.
 */
export function playArrival(main: HTMLElement | null): void {
  if (!main?.animate || motionLevel() !== 'full') return;
  const duration = parseFloat(getComputedStyle(main).getPropertyValue('--dur-medium')) || 220;
  main.animate(ARRIVE, { duration, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
}
