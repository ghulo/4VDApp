import { Figure } from './Motion';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from '@phosphor-icons/react';
import { Children, cloneElement, Fragment, isValidElement, type ReactElement, type ReactNode, useId } from 'react';
import { Link } from 'react-router';
import { useT } from '../../i18n/useT';
import { formatPercent, formatTimes, MUCH_MORE } from '../../utils/format';
import { changeDirection } from './sparkline';

const ARROWS = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight } as const;

interface MetricCardProps {
  label: string;
  value: ReactNode;
  /** Against the period before, as a fraction (0.12 = 12% more). Null: nothing to compare with. Leave out to show no change. */
  change?: number | null;
  /** Makes the whole tile a link to the page behind the figure. */
  to?: string;
  /** A line under the figure, e.g. what isn't included. */
  hint?: ReactNode;
}

/**
 * One figure with how it moved against the period before: the same tile as a
 * StatTile (label, figure, a line under it), in the same hairline panel. No
 * mini graph: a trend belongs in the page's one main chart (DESIGN.md 10).
 */
export function MetricCard({ label, value, change, to, hint }: MetricCardProps) {
  const t = useT();
  const headingId = useId();
  // Down to nothing is always "↘100%", which says no more than the €0 beside it
  // and reads as an alarm on a quiet day, so no change line.
  const direction = change === undefined || change === -1 ? undefined : changeDirection(change);
  const muchMore = change !== undefined && change !== null && change > MUCH_MORE;

  const body = (
    <>
      <h3 id={headingId} className="stat__label">
        {label}
      </h3>
      <p className="stat__value">
        <Figure value={value} />
      </p>
      {direction && change !== null && change !== undefined && (
        <p className={`stat__change stat__change--${direction}`}>
          <span aria-hidden="true">
            <span className="stat__change-figure">
              <ChangeArrow direction={direction} />
              {muchMore ? formatTimes(change) : formatPercent(Math.abs(change))}
            </span>{' '}
            {t.analytics.vsBefore}
          </span>
          <span className="visually-hidden">
            {muchMore
              ? t.analytics.timesBefore(formatTimes(change))
              : direction === 'flat'
                ? t.reports.sameAsBefore
                : t.reports.change({ up: direction === 'up', percent: formatPercent(Math.abs(change)) })}
          </span>
        </p>
      )}
      {/* Nothing the period before: nothing to see, but screen readers still hear why there's no percent. */}
      {direction === null && <span className="visually-hidden">{t.analytics.noneBeforeLong}</span>}
      {hint && <div className="stat__hint">{hint}</div>}
    </>
  );

  return to ? (
    <Link to={to} className="stat stat--link" aria-labelledby={headingId}>
      {body}
    </Link>
  ) : (
    <article className="stat" aria-labelledby={headingId}>
      {body}
    </article>
  );
}

function ChangeArrow({ direction }: { direction: keyof typeof ARROWS }) {
  const Arrow = ARROWS[direction];
  return <Arrow size={12} weight="bold" />;
}

/** Fragments (a page passing a group of tiles) open up, so each tile counts as a cell. */
function flatten(children: ReactNode, prefix = ''): ReactNode[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) return [child];
    // Keys restart inside each fragment, so they carry the fragment's key to stay unique.
    if (child.type === Fragment) return flatten((child as ReactElement<{ children?: ReactNode }>).props.children, `${prefix}${child.key}/`);
    return [prefix ? cloneElement(child, { key: `${prefix}${child.key}` }) : child];
  });
}

/** Columns for more than six tiles: the count that fills every row, else four. */
const manyColumns = (count: number) => [4, 3, 5].find((cols) => count % cols === 0) ?? 4;

/**
 * Metric tiles on one raised panel split by hairlines: the same panel as
 * StatGrid, so every strip of figures in 4VD looks alike. Up to six sit in
 * one row; more wrap into rows that fill where they can.
 */
export function MetricGrid({ children, title }: { children: ReactNode; /** A heading for screen readers, where the figures sit right under the page title (the tiles' own labels are h3). */ title?: string }) {
  const tiles = flatten(children);
  const many = tiles.length > 6;
  return (
    <div className="stat-grid-room">
      {title && <h2 className="visually-hidden">{title}</h2>}
      <div className="stat-grid" data-count={many ? undefined : tiles.length} data-cols={many ? manyColumns(tiles.length) : undefined}>
        {tiles}
      </div>
    </div>
  );
}
