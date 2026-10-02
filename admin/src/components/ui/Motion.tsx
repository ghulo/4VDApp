import { Check } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { dotColumn } from './dots';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * A figure whose digits roll into place once, like the counters on Cloudflare's
 * site. Screen readers get the plain value; reduced motion skips the roll (ui.css).
 */
export function RollingNumber({ value, className }: { value: string; className?: string }) {
  const [rolled, setRolled] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setRolled(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <span className={['roll', className].filter(Boolean).join(' ')} aria-label={value} role="text">
      {[...value].map((character, index) =>
        DIGITS.includes(character) ? (
          <span key={index} className="roll__digit" aria-hidden="true">
            <span
              className="roll__strip"
              style={{
                transform: `translateY(-${(rolled ? Number(character) : 0) * 10}%)`,
                transitionDelay: `${index * 40}ms`,
              }}
            >
              {DIGITS.map((digit) => (
                <span key={digit}>{digit}</span>
              ))}
            </span>
          </span>
        ) : (
          <span key={index} aria-hidden="true">
            {character}
          </span>
        ),
      )}
    </span>
  );
}

const STEP = 5;
const HEIGHT = 60;

/** A small dot-matrix bar chart for decoration, e.g. the last 30 days behind a figure. */
export function DotBars({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(...values, 0);
  const width = values.length * STEP;
  return (
    <svg
      className={['dot-bars', className].filter(Boolean).join(' ')}
      viewBox={`0 0 ${Math.max(width, STEP)} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {values.map((value, index) =>
        dotColumn({
          x: index * STEP,
          base: HEIGHT,
          height: max > 0 ? (value / max) * (HEIGHT - STEP) : 0,
          width: STEP,
          step: STEP,
          top: 0,
        }).map((dot) => (
          <circle
            key={`${index}-${dot.y}`}
            className={dot.lit ? 'dot-bars__lit' : 'dot-bars__unlit'}
            cx={dot.x}
            cy={dot.y}
            r={dot.lit ? 1.4 : 0.8}
          />
        )),
      )}
    </svg>
  );
}

/** A status pill sitting on a dotted line that runs to both edges. */
export function StatusLine({ children }: { children: ReactNode }) {
  return (
    <div className="status-line">
      <span className="status-line__pill">
        <Check size={14} weight="bold" aria-hidden="true" />
        {children}
      </span>
    </div>
  );
}
