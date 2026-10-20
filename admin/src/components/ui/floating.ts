import { type RefObject, useLayoutEffect } from 'react';

export type Side = 'top' | 'bottom';
export type Align = 'start' | 'center' | 'end';

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Room kept between a floating panel and the edge of the window. */
const EDGE = 8;

/**
 * Where a floating panel goes beside its anchor: on the side asked for, or
 * the other side when it doesn't fit there, and always inside the window.
 */
export function placeFloating(
  anchor: Box,
  panel: { width: number; height: number },
  view: { width: number; height: number },
  side: Side = 'bottom',
  align: Align = 'center',
  gap = 6,
): { top: number; left: number; side: Side } {
  const above = anchor.top - gap - panel.height;
  const below = anchor.top + anchor.height + gap;
  const fitsAbove = above >= EDGE;
  const fitsBelow = below + panel.height <= view.height - EDGE;
  const chosen: Side = side === 'top' ? (fitsAbove || !fitsBelow ? 'top' : 'bottom') : fitsBelow || !fitsAbove ? 'bottom' : 'top';
  const left =
    align === 'start' ? anchor.left : align === 'end' ? anchor.left + anchor.width - panel.width : anchor.left + (anchor.width - panel.width) / 2;
  const clamp = (value: number, max: number) => Math.max(EDGE, Math.min(value, max - EDGE));
  return {
    top: Math.round(Math.max(EDGE, chosen === 'top' ? above : below)),
    left: Math.round(clamp(left, view.width - panel.width)),
    side: chosen,
  };
}

/**
 * Keeps a floating panel (a `popover` element, so it sits above dialogs and is
 * never clipped by a scrolling box) beside its anchor while it is open,
 * following scrolls and window resizes.
 */
export function useFloating(
  anchor: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  open: boolean,
  { side = 'bottom', align = 'center', matchWidth = false, follow }: { side?: Side; align?: Align; matchWidth?: boolean; follow?: unknown } = {},
) {
  useLayoutEffect(() => {
    // Shown before it is measured: a hidden popover has no size.
    setPopover(panel.current, open);
    if (!open) return;
    const place = () => {
      const target = anchor.current;
      const floating = panel.current;
      if (!target || !floating) return;
      const rect = target.getBoundingClientRect();
      if (matchWidth) floating.style.minWidth = `${rect.width}px`;
      const spot = placeFloating(rect, floating.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, side, align);
      floating.style.top = `${spot.top}px`;
      floating.style.left = `${spot.left}px`;
      floating.dataset.side = spot.side;
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
    // `follow` changes when the panel moves to another anchor or its words change size.
  }, [anchor, panel, open, side, align, matchWidth, follow]);
}

/** Shows or hides a `popover` element, where the browser has them (tests and old browsers just skip it). */
export function setPopover(element: HTMLElement | null, show: boolean) {
  if (!element || typeof element.showPopover !== 'function') return;
  const shown = element.matches(':popover-open');
  if (show && !shown) element.showPopover();
  if (!show && shown) element.hidePopover();
}
