/**
 * A phone used by touch alone: tapping (or focusing) a text field there pops
 * the on-screen keyboard up over half the screen, so 4VD shouldn't focus
 * fields by itself. The shop PC, a laptop and the Windows app keep it.
 *
 * - Touch alone: the main pointer is a finger and no mouse or trackpad is attached.
 * - Phone-sized: the screen's short side is under 600px (a touch-only till is wider).
 * - No keys seen: once a key is pressed outside a text field (a scanner or a
 *   real keyboard; an on-screen keyboard only types into fields), this page
 *   counts as having a keyboard until it reloads.
 */

let keysSeen = false;

if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (event) => {
      if (keysSeen) return;
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'));
      if (!typing) keysSeen = true;
    },
    { capture: true },
  );
}

export function touchPhone(): boolean {
  if (typeof window === 'undefined' || keysSeen || window.fourvdDesktop || !window.matchMedia) return false;
  if (!window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(any-pointer: fine)').matches) return false;
  return Math.min(window.screen.width, window.screen.height) < 600;
}
