import { useMemo, useState } from 'react';
import type { RevenuePoint } from '../services/types';
import { formatMoney } from '../utils/format';
import { dotColumn } from './ui/dots';
import { useT } from '../i18n/useT';

const WIDTH = 720;
const HEIGHT = 220;
const MARGIN = { top: 12, right: 8, bottom: 28, left: 56 };
const MAX_BAR_WIDTH = 24;
const BAR_GAP = 2;
/** Distance between dots: each day's column is drawn in dots, like Cloudflare's waveforms. */
const DOT_STEP = 6;
const TICK_COUNT = 4;


/** Round the axis top up to a clean number (1, 2, 2.5 or 5 times a power of ten). */
function niceMax(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value)!;
  return step * magnitude;
}

interface RevenueChartProps {
  points: RevenuePoint[];
  title: string;
}

export function RevenueChart({ points, title }: RevenueChartProps) {
  const t = useT();
  const { dayLabel, compactMoney } = useMemo(
    () => ({
      dayLabel: new Intl.DateTimeFormat(t.dateLocale, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      compactMoney: new Intl.NumberFormat(t.numberLocale, {
        style: 'currency',
        currency: 'EUR',
        notation: 'compact',
        maximumFractionDigits: 1,
      }),
    }),
    [t],
  );
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const maxValue = niceMax(Math.max(...points.map((point) => point.revenue), 0));
  const band = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.min(MAX_BAR_WIDTH, band - BAR_GAP);
  const yFor = (value: number) => MARGIN.top + plotHeight - (value / maxValue) * plotHeight;
  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, index) => (maxValue / TICK_COUNT) * index);
  // Label roughly every week so dates never collide.
  const labelEvery = Math.max(1, Math.ceil(points.length / 5));

  const active = activeIndex === null ? null : points[activeIndex];
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
        <div className="chart__plot" onPointerLeave={() => setActiveIndex(null)}>
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={t.chart.summary({
              title,
              best: best ? { day: dayLabel.format(new Date(best.periodStart)), amount: formatMoney(best.revenue) } : null,
            })}
          >
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
              const x = bandX + (band - barWidth) / 2;
              const y = yFor(point.revenue);
              const height = MARGIN.top + plotHeight - y;
              const isActive = index === activeIndex;
              return (
                <g
                  key={point.periodStart}
                  tabIndex={0}
                  role="img"
                  aria-label={t.chart.point({ day: dayLabel.format(new Date(point.periodStart)), amount: formatMoney(point.revenue), count: point.salesCount })}
                  onPointerEnter={() => setActiveIndex(index)}
                  onFocus={() => setActiveIndex(index)}
                  onBlur={() => setActiveIndex(null)}
                  className="chart__column"
                >
                  {/* The whole column is the hit target, not just the painted bar. */}
                  <rect x={bandX} y={MARGIN.top} width={band} height={plotHeight} fill="transparent" />
                  {dotColumn({
                    x,
                    base: MARGIN.top + plotHeight,
                    height,
                    width: barWidth,
                    step: DOT_STEP,
                    top: MARGIN.top,
                  }).map((dot) => (
                    <circle
                      key={`${dot.x}-${dot.y}`}
                      className={dot.lit ? (isActive ? 'chart__dot chart__dot--active' : 'chart__dot') : 'chart__dot chart__dot--empty'}
                      cx={dot.x}
                      cy={dot.y}
                      r={dot.lit ? 2.1 : 1.1}
                    />
                  ))}
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
        </div>
      )}
    </figure>
  );
}
