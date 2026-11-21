import type { KeyboardEvent } from 'react';

const NEXT: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Arrow keys, Home and End inside a role="radiogroup" of buttons: move to the
 * next choice and pick it, as a native radio group does. The group is one tab
 * stop: give the checked choice tabIndex 0 and the rest -1.
 */
export function radioKeys(event: KeyboardEvent<HTMLElement>) {
  const radios = [...(event.currentTarget.closest('[role="radiogroup"]')?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])];
  const at = radios.indexOf(event.currentTarget);
  if (at < 0) return;
  let to: number;
  if (event.key in NEXT) to = (at + NEXT[event.key] + radios.length) % radios.length;
  else if (event.key === 'Home') to = 0;
  else if (event.key === 'End') to = radios.length - 1;
  else return;
  event.preventDefault();
  radios[to].focus();
  radios[to].click();
}
