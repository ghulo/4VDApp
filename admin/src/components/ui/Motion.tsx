import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';

/** How long a change shows before the piece settles back to plain text (just over --motion-quick). */
const SETTLE_MS = 260;

/*
 * Small moving pieces of the shared motion vocabulary (DESIGN.md 12). The
 * keyframes live in styles/motion.css; under reduced motion they don't run
 * and each piece simply shows its final state.
 */

/**
 * Remembers the value shown before the current one, and counts the changes
 * (0 on first show). A moment after each change the old value is forgotten,
 * so the piece settles back to plain text (copies and reads cleanly); a timer,
 * not animationend, so it settles under reduced motion too.
 */
function useChange<T>(value: T) {
  const [state, setState] = useState({ now: value, before: value, turn: 0 });
  const changing = !Object.is(state.now, state.before);
  useEffect(() => {
    if (!changing) return;
    const timer = window.setTimeout(() => setState((was) => ({ ...was, before: was.now })), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [changing, state.turn]);
  if (!Object.is(state.now, value)) {
    const next = { now: value, before: state.now, turn: state.turn + 1 };
    setState(next);
    return next;
  }
  return state;
}

/** Bigger or smaller, from the digits alone ("€1.234,50" and "1,234.50" both work). */
function direction(before: string, now: string): 'up' | 'down' {
  const digits = (text: string) => text.replace(/\D/g, '').replace(/^0+/, '');
  const a = digits(before);
  const b = digits(now);
  const bigger = b.length !== a.length ? b.length > a.length : b > a;
  const sign = (text: string) => (/[-−]/.test(text) ? -1 : 1);
  return (bigger ? 1 : -1) * sign(now) > 0 ? 'up' : 'down';
}

/**
 * An amount of money split into euros and the cents after them ("€1,482" +
 * ".40", "1.482" + ",40 €"), so a big figure can set its cents smaller and
 * quieter. Anything that isn't money with cents stays whole.
 */
export function splitMinor(text: string): [string, string] {
  if (!text.includes('€')) return [text, ''];
  const match = /[.,]\d{2}(?:\s?€)?$/.exec(text);
  return match ? [text.slice(0, match.index), match[0]] : [text, ''];
}

/**
 * A figure whose changed digits roll in place: the old digit leaves, the new
 * one arrives from below (going up) or above (going down). At rest it is
 * plain text, so it reads and copies like any other number.
 */
export function RollingNumber({ value, className }: { value: string; className?: string }) {
  const { now, before, turn } = useChange(value);
  const name = ['num', className].filter(Boolean).join(' ');
  if (turn === 0 || now === before) {
    const [major, minor] = splitMinor(now);
    return (
      <span className={name}>
        {major}
        {minor && <span className="num__minor">{minor}</span>}
      </span>
    );
  }
  const dir = direction(before, now);
  // Digits line up from the right, so "9.99" → "10.00" rolls each place.
  const cells = [...now].map((char, index) => {
    const old = before[before.length - (now.length - index)];
    if (old === char) return char;
    return (
      <span key={`${turn}-${index}`} className="num__cell">
        {old !== undefined && (
          <span className="num__out" aria-hidden="true">
            {old}
          </span>
        )}
        <span className="num__in">{char}</span>
      </span>
    );
  });
  // The cents keep their smaller size while they roll, so nothing jumps.
  const majorLength = splitMinor(now)[0].length;
  return (
    <span className={name} data-dir={dir}>
      {cells.slice(0, majorLength)}
      {majorLength < cells.length && <span className="num__minor">{cells.slice(majorLength)}</span>}
    </span>
  );
}

/** A figure that may be a string or something else: strings roll, the rest show as they are. */
export function Figure({ value }: { value: ReactNode }) {
  return typeof value === 'string' || typeof value === 'number' ? <RollingNumber value={String(value)} /> : <>{value}</>;
}

/**
 * Words that swap with a soft blur: "Saving…" → "Saved". The new words blur
 * in over the old ones as they blur out. Keep any role="status" on the parent.
 * `shimmer` makes the words shimmer while they show (while 4VD reads).
 */
export function SwapText({ children, className, shimmer }: { children: string; className?: string; shimmer?: boolean }) {
  const { now, before, turn } = useChange(children);
  const name = ['swap-text', className].filter(Boolean).join(' ');
  const words = shimmer ? <ShimmerText>{now}</ShimmerText> : now;
  if (turn === 0 || now === before) return <span className={name}>{words}</span>;
  return (
    <span className={name}>
      <span key={`out-${turn}`} className="swap-text__out" aria-hidden="true">
        {before}
      </span>
      <span key={`in-${turn}`} className="swap-text__in">
        {words}
      </span>
    </span>
  );
}

/**
 * Words that shimmer while 4VD is thinking (Claude reading a bill or a
 * statement): a soft wave of light runs across them, word by word, in the
 * text's own ink. Opacity only.
 */
export function ShimmerText({ children, className }: { children: string; className?: string }) {
  const words = children.split(/(\s+)/);
  return (
    <span className={['shimmer-text', className].filter(Boolean).join(' ')}>
      {words.map((word, index) =>
        /^\s+$/.test(word) ? (
          word
        ) : (
          <span key={index} style={{ '--i': index / 2 } as CSSProperties}>
            {word}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * A ring that fills and a tick that turns into place: "done". With `busy`
 * it is a spinning arc first, which turns into the check when busy ends.
 */
export function SuccessCheck({ size = 20, busy = false, className }: { size?: number; busy?: boolean; className?: string }) {
  return (
    <svg
      className={['success-check', busy ? 'success-check--busy' : 'success-check--done', className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="success-check__arc" cx="12" cy="12" r="10" pathLength={100} />
      <g className="success-check__mark">
        <circle className="success-check__ring" cx="12" cy="12" r="11" />
        <path className="success-check__tick" d="M7.2 12.4l3.2 3.2 6.4-6.6" />
      </g>
    </svg>
  );
}

/** How long a big figure waits before rolling up, so it lands after its screen has arrived. */
const ROLL_UP_DELAY_MS = 120;

/**
 * A big figure that rolls up from zero when it first shows (the change to
 * give back on the Paid screen). Screen readers get the real figure at once;
 * under reduced motion it simply shows.
 */
export function RollUp({ value, from, className }: { value: string; from: string; className?: string }) {
  const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(still ? value : from);
  useEffect(() => {
    if (shown === value) return;
    const timer = window.setTimeout(() => setShown(value), ROLL_UP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [shown, value]);
  return (
    <span className={className}>
      <span className="visually-hidden">{value}</span>
      <span aria-hidden="true">
        <RollingNumber value={shown} />
      </span>
    </span>
  );
}
