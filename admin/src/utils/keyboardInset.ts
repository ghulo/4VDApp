/**
 * The phone's on-screen keyboard, told to the CSS.
 *
 * Android Chrome (with `interactive-widget=resizes-content` in index.html) makes
 * the page shorter while the keyboard is up, so fixed bars move above it by
 * themselves. iPhone Safari ignores that and lays the keyboard over the page.
 * This keeps two things on <html> up to date:
 *  - `--keyboard-h`: how much of the page's bottom the keyboard covers (iPhone; 0 on Android),
 *    so bottom cards, the till's panels and sticky Save rows can sit above it;
 *  - `data-keyboard`: set while a keyboard is up (either kind), so the bottom tab bars step aside.
 */

/** Taller than this counts as a keyboard; smaller changes are the address bar coming and going. */
const KEYBOARD_MIN = 120;

export interface ViewportReading {
  /** The page's own height (the layout viewport). */
  layout: number;
  /** The tallest the page has been at this width (no keyboard). */
  tallest: number;
  /** The visible part, and how far it is scrolled down within the page. */
  visibleHeight: number;
  visibleTop: number;
  /** Pinch zoom; while zoomed the visible part is small for another reason. */
  scale: number;
  /** A text field has focus. */
  editing: boolean;
  /** A touch screen: a shorter page on a PC is a resized window, not a keyboard. */
  touch: boolean;
}

export function keyboardState(reading: ViewportReading): { covered: number; open: boolean } {
  const zoomed = reading.scale > 1.01;
  const covered = zoomed ? 0 : Math.max(0, Math.round(reading.layout - reading.visibleHeight - reading.visibleTop));
  const shrunk = reading.tallest - reading.layout;
  const open = covered > KEYBOARD_MIN || (reading.touch && reading.editing && shrunk > KEYBOARD_MIN);
  return { covered: covered > KEYBOARD_MIN ? covered : 0, open };
}

const TEXT_INPUTS = new Set(['text', 'search', 'email', 'number', 'tel', 'url', 'password', 'date', 'time', 'datetime-local', 'month']);

function editing(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (active.isContentEditable || active instanceof HTMLTextAreaElement) return true;
  return active instanceof HTMLInputElement && TEXT_INPUTS.has(active.type);
}

export function startKeyboardInset(): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => undefined;
  const root = document.documentElement;
  const coarse = window.matchMedia('(pointer: coarse)');
  let width = 0;
  let tallest = 0;
  let last = '';

  const update = () => {
    if (window.innerWidth !== width) {
      // Turned or resized: start over measuring the full height.
      width = window.innerWidth;
      tallest = 0;
    }
    const layout = root.clientHeight;
    tallest = Math.max(tallest, layout);
    const { covered, open } = keyboardState({
      layout,
      tallest,
      visibleHeight: viewport.height,
      visibleTop: viewport.offsetTop,
      scale: viewport.scale,
      editing: editing(),
      touch: coarse.matches,
    });
    const now = `${covered}|${open}`;
    if (now === last) return;
    last = now;
    root.style.setProperty('--keyboard-h', `${covered}px`);
    root.toggleAttribute('data-keyboard', open);
  };
  // Focus leaving a field lands before the keyboard has gone: look again once it has.
  let later: number | undefined;
  const settle = () => {
    update();
    window.clearTimeout(later);
    later = window.setTimeout(update, 300);
  };

  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  document.addEventListener('focusin', settle);
  document.addEventListener('focusout', settle);
  update();
  return () => {
    window.clearTimeout(later);
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
    window.removeEventListener('resize', update);
    document.removeEventListener('focusin', settle);
    document.removeEventListener('focusout', settle);
  };
}
