import { type KeyboardEvent, useId, useState } from 'react';
import type { RevenuePoint } from '../services/types';
import { formatCompactMoney, formatDateWith, formatMoney } from '../utils/format';
import { useT } from '../i18n/useT';

const WIDTH = 720;
const HEIGHT = 220;
const MARGIN = { top: 12, right: 8, bottom: 28, left: 56 };
const MAX_BAR_WIDTH = 14;
/** Room between bars, as a share of each day's slot. */
const BAR_GAP = 0.35;
/** Corner radius on the top of each bar. */
const BAR_RADIUS = 2.5;
const TICK_COUNT = 4;

/** Round the axis top up to a clean number (1, 2, 2.5 or 5 times a power of ten). */
function niceMax(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value)!;
  return step * magnitude;
}

/** A bar from `top` down to `base`, with only its top corners rounded. */
function barPath(x: number, width: number, top: number, base: number): string {
  const r = Math.min(BAR_RADIUS, width / 2, base - top);
  return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${base} Z`;
}

interface RevenueChartProps {
  points: RevenuePoint[];
  title: string;
}

export function RevenueChart({ points, title }: RevenueChartProps) {
  const t = useT();
  const dayLabel = { format: (date: Date) => formatDateWith(date, { day: 'numeric', month: 'short', timeZone: 'UTC' }) };
  const compactMoney = { format: formatCompactMoney };
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const hintId = useId();

  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const maxValue = niceMax(Math.max(...points.map((point) => point.revenue), 0));
  const band = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.max(1, Math.min(MAX_BAR_WIDTH, band * (1 - BAR_GAP)));
  const yFor = (value: number) => MARGIN.top + plotHeight - (value / maxValue) * plotHeight;
  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, index) => (maxValue / TICK_COUNT) * index);
  // Label roughly every week so dates never collide.
  const labelEvery = Math.max(1, Math.ceil(points.length / 5));

  const active = activeIndex === null ? null : points[activeIndex];

  // The plot is one stop for the keyboard; the arrow keys walk the days.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = points.length - 1;
    const from = activeIndex ?? -1;
    const next =
      event.key === 'ArrowRight' ? Math.min(last, from + 1)
      : event.key === 'ArrowLeft' ? Math.max(0, from === -1 ? last : from - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null;
    if (next === null || last < 0) return;
    event.preventDefault();
    setActiveIndex(next);
  }
  const best = points.reduce<RevenuePoint | null>((top, point) => (point.revenue > (top?.revenue ?? 0) ? point : top), null);

  return (
    <figure className="chart">
      <figcaption className="chart__header">
        <span className="chart__title">{title}</span>
        <button type="button" className="text-button" onClick={() => setShowTable((value) => !value)}>
          {showTable ? t.chart.showChart : t.chart.showTable}
        </button>
      </figcaption>

      {showTable ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t.chart.day}</th>
                <th scope="col" className="table__numeric">
                  {t.chart.revenue}
                </th>
                <th scope="col" className="table__numeric">
                  {t.chart.sales}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.periodStart}>
                  <td>{dayLabel.format(new Date(point.periodStart))}</td>
                  <td className="table__numeric">{formatMoney(point.revenue)}</td>
                  <td className="table__numeric">{point.salesCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="chart__plot"
          tabIndex={0}
          role="group"
          aria-label={t.chart.summary({
            title,
            best: best ? { day: dayLabel.format(new Date(best.periodStart)), amount: formatMoney(best.revenue) } : null,
          })}
          aria-describedby={hintId}
          onKeyDown={onKeyDown}
          onBlur={() => setActiveIndex(null)}
          onPointerLeave={() => setActiveIndex(null)}
        >
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  className="chart__grid"
                  x1={MARGIN.left}
                  x2={WIDTH - MARGIN.right}
                  y1={yFor(tick)}
                  y2={yFor(tick)}
                />
                <text className="chart__tick" x={MARGIN.left - 8} y={yFor(tick)} textAnchor="end" dominantBaseline="middle">
                  {compactMoney.format(tick)}
                </text>
              </g>
            ))}

            {points.map((point, index) => {
              const bandX = MARGIN.left + index * band;
              const y = yFor(point.revenue);
              return (
                <g key={point.periodStart} className="chart__column" onPointerEnter={() => setActiveIndex(index)}>
                  {/* The whole column is the hit target, not just the painted bar. */}
                  <rect x={bandX} y={MARGIN.top} width={band} height={plotHeight} fill="transparent" />
                  {point.revenue > 0 && (
                    <path
                      className={index === activeIndex ? 'chart__bar chart__bar--active' : 'chart__bar'}
                      // Any sale at all shows at least a sliver, so quiet days still register.
                      d={barPath(bandX + (band - barWidth) / 2, barWidth, Math.min(y, MARGIN.top + plotHeight - 2), MARGIN.top + plotHeight)}
                    />
                  )}
                  {index % labelEvery === 0 && (
                    <text className="chart__tick" x={bandX + band / 2} y={HEIGHT - 8} textAnchor="middle">
                      {dayLabel.format(new Date(point.periodStart))}
                    </text>
                  )}
                </g>
              );
            })}

            <line
              className="chart__baseline"
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={MARGIN.top + plotHeight}
              y2={MARGIN.top + plotHeight}
            />
          </svg>

          {active && activeIndex !== null && (
            <div
              className="chart__tooltip"
              role="status"
              style={{
                left: `${((MARGIN.left + (activeIndex + 0.5) * band) / WIDTH) * 100}%`,
                top: `${(yFor(active.revenue) / HEIGHT) * 100}%`,
              }}
            >
              <strong>{formatMoney(active.revenue)}</strong>
              <span>
                {dayLabel.format(new Date(active.periodStart))}, {t.chart.salesCount(active.salesCount)}
              </span>
            </div>
          )}
          <span id={hintId} className="visually-hidden">
            {t.chart.keysHint}
          </span>
        </div>
      )}
    </figure>
  );
}
