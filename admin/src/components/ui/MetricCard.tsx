import { ArrowDownRight, ArrowRight, ArrowUpRight, DotsThree } from '@phosphor-icons/react';
import { type ReactNode, useId } from 'react';
import { Link } from 'react-router';
import { useT } from '../../i18n/useT';
import { formatPercent, MUCH_MORE } from '../../utils/format';
import { changeDirection, SPARK_COLUMNS, SPARK_ROWS, sparkBlocks } from './sparkline';

const ARROWS = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight } as const;

interface MetricCardProps {
  label: string;
  value: ReactNode;
  /** Against the period before, as a fraction (0.12 = 12% more). Null: nothing to compare with. Leave out to show no badge. */
  change?: number | null;
  /** One value per day (or week), oldest first, for the mini graph. Leave out for a figure without a graph. */
  series?: number[];
  /** Spans two columns, for the figure that matters most. */
  large?: boolean;
  /** The page behind the figure, opened from the ⋯ in the corner. */
  to?: string;
  /** A line under the figure, e.g. what isn't included. */
  hint?: ReactNode;
}

/**
 * One figure on an analytics board: the number, which way it moved against
 * the period before, and a mini graph of how it got there in printed blocks.
 * With no data it shows the empty block grid and "No data" instead of an empty box.
 */
export function MetricCard({ label, value, change, series, large, to, hint }: MetricCardProps) {
  const t = useT();
  const headingId = useId();
  const direction = change === undefined ? undefined : changeDirection(change);
  const columns = large ? SPARK_COLUMNS * 2 : SPARK_COLUMNS;
  const blocks = series ? sparkBlocks(series, SPARK_ROWS, columns) : null;
  const muchMore = change !== undefined && change !== null && change > MUCH_MORE;

  return (
    <article className={large ? 'metric metric--large' : 'metric'} aria-labelledby={headingId}>
      <div className="metric__head">
        <h3 id={headingId} className="metric__label">
          {label}
        </h3>
        {to && (
          <Link to={to} className="metric__more" aria-label={t.analytics.open(label)}>
            <DotsThree size={18} weight="bold" aria-hidden="true" />
          </Link>
        )}
      </div>
      <p className="metric__figure">
        <span className="metric__value">{value}</span>
        {direction && change !== null && change !== undefined && (
          <span className={`metric__change metric__change--${direction}`}>
            <span className="metric__change-shown" aria-hidden="true">
              <ChangeArrow direction={direction} />
              {muchMore ? t.analytics.muchMore : formatPercent(Math.abs(change))}
            </span>
            <span className="visually-hidden">
              {muchMore
                ? t.analytics.muchMoreThanBefore
                : direction === 'flat'
                  ? t.reports.sameAsBefore
                  : t.reports.change({ up: direction === 'up', percent: formatPercent(Math.abs(change)) })}
            </span>
          </span>
        )}
        {direction === null && <span className="visually-hidden">{t.reports.nothingToCompare}</span>}
      </p>
      {hint && <p className="metric__hint">{hint}</p>}
      {series &&
        (blocks ? (
          <BlockGraph columns={blocks} />
        ) : (
          <div className="metric__empty">
            <BlockGraph columns={Array.from({ length: columns }, () => 0)} />
            <span className="metric__no-data">{t.analytics.noData}</span>
          </div>
        ))}
    </article>
  );
}

/**
 * Columns of printed blocks, laid out by CSS grid so they never stretch: lit
 * blocks in the series colour, the latest column in ink, the rest faint.
 */
function BlockGraph({ columns }: { columns: number[] }) {
  return (
    <div className="metric__graph" style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }} aria-hidden="true">
      {columns.map((lit, column) => (
        <span key={column} className={column === columns.length - 1 ? 'metric__column metric__column--latest' : 'metric__column'}>
          {Array.from({ length: SPARK_ROWS }, (_, row) => (
            <span key={row} className={row < lit ? 'metric__block metric__block--lit' : 'metric__block'} />
          ))}
        </span>
      ))}
    </div>
  );
}

function ChangeArrow({ direction }: { direction: keyof typeof ARROWS }) {
  const Arrow = ARROWS[direction];
  return <Arrow size={12} weight="bold" />;
}

/** Metric cards in a grid: large cards take two columns, everything stacks on a phone. */
export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="metric-grid">{children}</div>;
}
