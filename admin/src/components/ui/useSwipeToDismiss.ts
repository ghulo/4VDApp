import { type RefObject, useEffect, useRef } from 'react';

interface SwipeOptions {
  /** The edge the panel leaves by. */
  side: 'left' | 'right';
  /** The panel's resting transform when closed, e.g. translateX(100%). */
  closed: string;
  onDismiss: () => void;
  enabled: boolean;
  /** Gets --swipe (0 open to 1 gone) and data-swiping, for the dimmed backdrop. */
  progressTarget?: () => HTMLElement | null;
}

/** Movement before deciding between a sideways swipe and a scroll. */
const SLOP = 10;
/** A flick faster than this (px/s) decides by its direction alone. */
const FLICK = 300;
/** --ease starts at 6.25x its average speed, which lets it pick up the finger's speed. */
const EASE_START_SPEED = 6.25;

/** Where a flick would come to rest, Apple's scroll deceleration (Designing Fluid Interfaces). */
export function projectMomentum(velocity: number, rate = 0.998): number {
  return ((velocity / 1000) * rate) / (1 - rate);
}

/** Past an edge the panel follows less and less, instead of stopping dead. */
export function rubberband(overshoot: number, size: number, constant = 0.55): number {
  return (overshoot * size * constant) / (size + constant * Math.abs(overshoot));
}

/** Whether a release should close the panel, from how far it is out and how fast it is going. */
export function shouldDismiss(out: number, velocity: number, size: number): boolean {
  if (Math.abs(velocity) > FLICK) return velocity > 0;
  return out + projectMomentum(velocity) > size / 2;
}

/** How long the settle takes so it starts at the finger's speed, within reason. */
export function settleTime(distance: number, velocity: number): number {
  const speed = Math.abs(velocity);
  const ms = speed > 0 ? (EASE_START_SPEED * Math.abs(distance) * 1000) / speed : Infinity;
  return Math.round(Math.min(450, Math.max(160, ms)));
}

/**
 * A phone panel (side sheet, menu drawer) that follows the finger sideways
 * and can be flicked away (DESIGN.md 12). Touch and pen only; the mouse keeps
 * clicks. Fields inside stay free for selecting text.
 */
export function useSwipeToDismiss(ref: RefObject<HTMLElement | null>, options: SwipeOptions): void {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const panel: HTMLElement = node;
    let pointer: number | null = null;
    let state: 'idle' | 'pending' | 'dragging' = 'idle';
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let history: { x: number; t: number }[] = [];
    let cleanup: number | undefined;

    const sign = () => (latest.current.side === 'right' ? 1 : -1);
    const progressTarget = () => latest.current.progressTarget?.() ?? panel;

    function onDown(event: PointerEvent) {
      if (!latest.current.enabled || event.pointerType === 'mouse' || !event.isPrimary) return;
      if ((event.target as Element).closest('input, textarea, select, [contenteditable], [data-no-swipe]')) return;
      pointer = event.pointerId;
      state = 'pending';
      startX = event.clientX;
      startY = event.clientY;
    }

    function onMove(event: PointerEvent) {
      if (event.pointerId !== pointer || state === 'idle') return;
      if (state === 'pending') {
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          state = 'idle'; // a scroll: leave it to the browser
          return;
        }
        state = 'dragging';
        // Track from here, so the panel doesn't jump by the slop.
        originX = event.clientX;
        history = [];
        window.clearTimeout(cleanup);
        panel.setPointerCapture(event.pointerId);
        panel.style.transitionProperty = 'none';
        progressTarget().dataset.swiping = '';
      }
      const size = panel.offsetWidth;
      const out = (event.clientX - originX) * sign();
      const shown = out >= 0 ? out : -rubberband(-out, size);
      panel.style.transform = `translateX(${shown * sign()}px)`;
      progressTarget().style.setProperty('--swipe', String(Math.min(1, Math.max(0, out / size))));
      const now = event.timeStamp;
      history.push({ x: event.clientX, t: now });
      while (history.length > 2 && now - history[0].t > 100) history.shift();
    }

    function onUp(event: PointerEvent) {
      if (event.pointerId !== pointer) return;
      pointer = null;
      if (state !== 'dragging') {
        state = 'idle';
        return;
      }
      state = 'idle';
      const size = panel.offsetWidth;
      const out = (event.clientX - originX) * sign();
      // Speed over the last 100ms only: a finger that stopped before lifting throws nothing.
      const recent = history.filter((point) => event.timeStamp - point.t <= 100);
      const first = recent[0];
      const last = recent[recent.length - 1];
      const velocity =
        first && last && last.t > first.t ? (((last.x - first.x) * sign()) / (last.t - first.t)) * 1000 : 0;
      const dismiss = event.type === 'pointerup' && shouldDismiss(out, velocity, size);
      const time = settleTime(dismiss ? size - out : out, velocity);

      // Hand over to the stylesheet, starting at the finger's speed.
      panel.style.removeProperty('transition-property');
      panel.style.transitionDuration = `${time}ms`;
      panel.style.transitionTimingFunction = 'var(--ease)';
      const target = progressTarget();
      delete target.dataset.swiping;
      target.style.removeProperty('--swipe');
      // The click that ends a drag isn't a tap on the backdrop.
      const swallow = (click: Event) => click.stopPropagation();
      panel.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => panel.removeEventListener('click', swallow, { capture: true }), 0);

      if (dismiss) {
        panel.style.transform = latest.current.closed;
        latest.current.onDismiss();
      } else {
        panel.style.removeProperty('transform');
      }
      cleanup = window.setTimeout(() => {
        panel.style.removeProperty('transform');
        panel.style.removeProperty('transition-duration');
        panel.style.removeProperty('transition-timing-function');
      }, time + 50);
    }

    panel.addEventListener('pointerdown', onDown);
    panel.addEventListener('pointermove', onMove);
    panel.addEventListener('pointerup', onUp);
    panel.addEventListener('pointercancel', onUp);
    return () => {
      window.clearTimeout(cleanup);
      panel.removeEventListener('pointerdown', onDown);
      panel.removeEventListener('pointermove', onMove);
      panel.removeEventListener('pointerup', onUp);
      panel.removeEventListener('pointercancel', onUp);
    };
  }, [ref]);
}
