/**
 * Plays the error shake on an element (a field, a PIN box): call it when a
 * try fails. Nothing happens under reduced motion (the animation is off).
 */
export function shake(element: Element | null) {
  if (!element) return;
  element.classList.remove('shake');
  // Restart the animation even when the same error comes twice in a row.
  void (element as HTMLElement).offsetWidth;
  element.classList.add('shake');
  element.addEventListener('animationend', () => element.classList.remove('shake'), { once: true });
}
