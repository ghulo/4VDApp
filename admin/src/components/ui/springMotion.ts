import { spring } from 'motion';

/**
 * A value moved on the Motion library's spring, driven frame by frame here.
 * Only the spring maths is used, so this file stays small; useSwipeToDismiss fetches it lazily.
 * Critically damped (bounce 0): it never overshoots (DESIGN.md 12).
 */
export function springTo(
  from: number,
  to: number,
  options: { velocity: number; visualDuration: number; onUpdate: (value: number) => void; onComplete: () => void },
): { stop: () => void } {
  const generator = spring({ keyframes: [from, to], velocity: options.velocity, bounce: 0, visualDuration: options.visualDuration });
  const start = performance.now();
  let frame = requestAnimationFrame(function step(now) {
    const { value, done } = generator.next(now - start);
    options.onUpdate(value);
    if (done) options.onComplete();
    else frame = requestAnimationFrame(step);
  });
  return { stop: () => cancelAnimationFrame(frame) };
}
