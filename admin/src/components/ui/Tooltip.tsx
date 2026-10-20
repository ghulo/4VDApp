import { cloneElement, type FocusEvent, type PointerEvent, type ReactElement, useEffect, useId, useRef, useState } from 'react';
import { type Side, setPopover, useFloating } from './floating';

/** A pointer resting this long on a key shows its name; a key reached by Tab shows it at once. */
const HOVER_DELAY = 400;

interface TooltipProps {
  /** The words shown: the same as the key's aria-label, so sighted and screen-reader users get one name. */
  label: string;
  /** Its keyboard shortcut, shown after the name, e.g. "Ctrl K". */
  shortcut?: string;
  side?: Side;
  /** One element that takes `data-ui-tooltip` (a button, a link, or a component that passes it on). */
  children: ReactElement<{ 'data-ui-tooltip'?: string }>;
}

/**
 * A key's name in a small ink label above it, for keys that show only an
 * icon. It appears on hover (after a short rest) and on keyboard focus, and
 * goes on Esc, a click or when the pointer leaves. Not on touch: a tap acts
 * at once. The label lives in the page all the time (hidden), linked by
 * `data-ui-tooltip`, so checkers can find it; it is a `popover`, so it is
 * never clipped by a scrolling box and shows above dialogs.
 */
export function Tooltip({ label, shortcut, side = 'top', children }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useFloating(anchorRef, tipRef, open, { side });

  useEffect(() => {
    setPopover(tipRef.current, open);
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // The key itself, measured when the label is about to show.
  const show = () => {
    anchorRef.current = (wrapRef.current?.firstElementChild as HTMLElement | null) ?? null;
    setOpen(true);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(show, HOVER_DELAY);
  };
  const onFocus = (event: FocusEvent) => {
    if ((event.target as HTMLElement).matches?.(':focus-visible')) show();
  };

  return (
    <span
      ref={wrapRef}
      className="tooltip-anchor"
      onPointerEnter={onPointerEnter}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={onFocus}
      onBlur={hide}
    >
      {cloneElement(children, { 'data-ui-tooltip': id })}
      <span ref={tipRef} id={id} role="tooltip" popover="manual" className="tooltip" aria-hidden="true">
        {label}
        {shortcut && <kbd className="tooltip__key">{shortcut}</kbd>}
      </span>
    </span>
  );
}
