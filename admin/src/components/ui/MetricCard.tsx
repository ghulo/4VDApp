import { ArrowDownRight, ArrowRight, ArrowUpRight, DotsThree } from '@phosphor-icons/react';
import { type ReactNode, useId } from 'react';
import { Link } from 'react-router';
import { useT } from '../../i18n/useT';
import { formatPercent, MUCH_MORE } from '../../utils/format';
import { changeDirection, PLACEHOLDER_WAVE, SPARK_HEIGHT, SPARK_WIDTH, sparklinePaths } from './sparkline';

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
 * the period before, and a filled mini graph of how it got there. With no
 * data it shows a faint wave and "No data" instead of an empty box.
 */
export function MetricCard({ label, value, change, series, large, to, hint }: MetricCardProps) {
  const t = useT();
  const headingId = useId();
  const direction = change === undefined ? undefined : changeDirection(change);
  const paths = series ? sparklinePaths(series) : null;
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
        (paths ? (
          <svg className="metric__graph" viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
            <path className="metric__area" d={paths.area} />
            <path className="metric__line" d={paths.line} vectorEffect="non-scaling-stroke" />
          </svg>
        ) : (
          <div className="metric__empty">
            <svg className="metric__graph" viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
              <path className="metric__wave" d={PLACEHOLDER_WAVE} vectorEffect="non-scaling-stroke" />
            </svg>
            <span className="metric__no-data">{t.analytics.noData}</span>
          </div>
        ))}
    </article>
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
