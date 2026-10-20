import { useT } from '../../i18n/useT';

/** Widths that look like real lines of text, repeated down the block. */
const WIDTHS = ['92%', '78%', '85%', '64%', '88%', '72%'];

/**
 * The shape of what is loading, drawn in sunk paper: lines of text, or the
 * rows of a table. Still (no shimmer: DESIGN.md 12 has no looping motion),
 * and like "Loading…" it waits 300ms, so a quick answer never flashes it.
 * Screen readers hear "Loading…".
 */
export function Skeleton({ rows = 3, kind = 'lines', label }: { rows?: number; kind?: 'lines' | 'table'; label?: string }) {
  const t = useT();
  return (
    <div className={`loading skeleton skeleton--${kind}`} role="status">
      <span className="visually-hidden">{label ?? t.common.loading}</span>
      {Array.from({ length: rows }, (_, index) =>
        kind === 'table' ? (
          <span key={index} className="skeleton__row" aria-hidden="true">
            <span className="skeleton__bar" style={{ inlineSize: WIDTHS[index % WIDTHS.length] }} />
            <span className="skeleton__bar skeleton__bar--figure" />
          </span>
        ) : (
          <span key={index} className="skeleton__bar" style={{ inlineSize: WIDTHS[index % WIDTHS.length] }} aria-hidden="true" />
        ),
      )}
    </div>
  );
}
