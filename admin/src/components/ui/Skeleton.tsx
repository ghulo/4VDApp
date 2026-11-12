import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/useT';

type Shape = 'lines' | 'table' | 'page';

/** Widths that look like real lines of text and names, repeated down the block. */
const WIDTHS = ['72%', '54%', '66%', '48%', '61%', '57%', '69%', '45%'];

const ROWS: Record<Shape, number> = { lines: 3, table: 5, page: 6 };

/**
 * Where the placeholder sits decides its shape, so the 80-odd plain
 * `<Loading />`s each look like what is coming without being told:
 * - in a table card: rows;
 * - in any other card, sheet or dialog: lines of text;
 * - on a page whose header isn't drawn yet (the whole page waits): a title,
 *   a strip of figures and a table;
 * - under a page's header (a list loading below its toolbar): rows.
 */
function shapeFor(element: HTMLElement): Shape {
  if (element.closest('.card--flush, .data-table')) return 'table';
  if (element.closest('.card, dialog, [role="dialog"], .sheet, .today')) return 'lines';
  const main = element.closest('main');
  if (!main) return 'lines';
  return main.querySelector('h1') ? 'table' : 'page';
}

/** One step of the wave: each piece fades a beat after the one above it. */
const beat = (index: number) => ({ '--i': index }) as CSSProperties;

function Row({ index, figure = true }: { index: number; figure?: boolean }) {
  return (
    <span className="skeleton__row" style={beat(index)}>
      <span className="skeleton__stack">
        <span className="skeleton__bar" style={{ inlineSize: WIDTHS[index % WIDTHS.length] }} />
        <span className="skeleton__bar skeleton__bar--meta" style={{ inlineSize: WIDTHS[(index + 3) % WIDTHS.length] }} />
      </span>
      {figure && <span className="skeleton__bar skeleton__bar--figure" />}
    </span>
  );
}

/**
 * The shape of what is loading, set into the page like an empty mould: lines
 * of text, the rows of a table, or a whole page (title, figures, table).
 * A slow wave runs down it while it waits (the one loop in 4VD, still under
 * reduced motion), and like "Loading…" it waits 300ms, so a quick answer
 * never flashes it. Screen readers hear "Loading…".
 */
export function Skeleton({ rows, kind = 'auto', label }: { rows?: number; kind?: Shape | 'auto'; label?: string }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [found, setFound] = useState<Shape>('lines');
  // Measured before the first paint, so the wrong shape is never seen.
  useLayoutEffect(() => {
    if (kind === 'auto' && ref.current) setFound(shapeFor(ref.current));
  }, [kind]);

  const shape = kind === 'auto' ? found : kind;
  const count = rows ?? ROWS[shape];
  let body: ReactNode;

  if (shape === 'lines') {
    body = Array.from({ length: count }, (_, index) => (
      <span
        key={index}
        className="skeleton__bar"
        style={{ ...beat(index), inlineSize: index === count - 1 && count > 1 ? '38%' : `${88 - (index % 3) * 9}%` }}
      />
    ));
  } else if (shape === 'table') {
    body = Array.from({ length: count }, (_, index) => <Row key={index} index={index} />);
  } else {
    body = (
      <>
        <span className="skeleton__head" style={beat(0)}>
          <span className="skeleton__bar skeleton__bar--title" />
          <span className="skeleton__bar skeleton__bar--meta" style={{ inlineSize: '34%' }} />
        </span>
        <span className="skeleton__tiles">
          {[0, 1, 2, 3].map((index) => (
            <span key={index} className="skeleton__tile" style={beat(index + 1)}>
              <span className="skeleton__bar skeleton__bar--meta" style={{ inlineSize: WIDTHS[index + 1] }} />
              <span className="skeleton__bar skeleton__bar--number" />
            </span>
          ))}
        </span>
        <span className="skeleton__panel">
          {Array.from({ length: count }, (_, index) => (
            <Row key={index} index={index + 3} />
          ))}
        </span>
      </>
    );
  }

  return (
    <div ref={ref} className={`loading skeleton skeleton--${shape}`} role="status">
      <span className="visually-hidden">{label ?? t.common.loading}</span>
      <span className="skeleton__shape" aria-hidden="true">
        {body}
      </span>
    </div>
  );
}
