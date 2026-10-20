import { type KeyboardEvent, useId, useState } from 'react';
import type { ChartColumn } from './ColumnChart';
import { scaleTop } from './sparkline';

/** Drawing size; the SVG stretches to the card, so only non-scaling strokes are drawn in it. */
const WIDTH = 600;
const PAD = 4;

/** Where each value sits, from 0 (left/top) to 1 (right/bottom); an outlier sits on the top edge. */
export function areaPoints(values: number[]): Array<{ x: number; y: number }> {
  if (values.length === 0) return [];
  const { top } = scaleTop(values);
  const max = top || 1;
  return values.map((value, index) => ({
    x: values.length === 1 ? 0.5 : index / (values.length - 1),
    y: 1 - Math.max(0, Math.min(value, max)) / max,
  }));
}

/**
 * One series over time as a smooth line over a faint fill: a month of days,
 * a year of months. Hovering or the arrow keys walk the points and show each
 * one's figure; screen readers get every point as a line of text. Drawn in
 * ink (DESIGN.md 10.7), amber stays for actions.
 */
export function AreaChart({ points, label, height = 160 }: { points: ChartColumn[]; label: string; height?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const tipId = useId();
  const spots = areaPoints(points.map((point) => point.value));
  const plot = height - PAD * 2;
  const xy = spots.map((spot) => [spot.x * WIDTH, PAD + spot.y * plot] as const);
  const line = xy.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = xy.length ? `${line} L${WIDTH},${height} L0,${height} Z` : '';
  const shown = active === null ? null : points[active];
  const spot = active === null ? null : spots[active];

  function onKeyDown(event: KeyboardEvent) {
    const last = points.length - 1;
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity };
    if (!(event.key in moves) || last < 0) return;
    event.preventDefault();
    setActive((index) => Math.max(0, Math.min(last, (index ?? (moves[event.key]! > 0 ? -1 : last + 1)) + moves[event.key]!)));
  }

  // Edge labels: the first, middle and last point, so dates never crowd.
  const ticks = points.length > 2 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : points.map((_, index) => index);
  return (
    <figure className="area-chart">
      <div
        className="area-chart__plot"
        style={{ blockSize: height }}
        tabIndex={points.length ? 0 : undefined}
        role="group"
        aria-label={label}
        aria-describedby={shown ? tipId : undefined}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - box.left) / box.width;
          setActive(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))));
        }}
      >
        <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          {[0.25, 0.5, 0.75].map((share) => (
            <line key={share} className="area-chart__grid" x1="0" x2={WIDTH} y1={height * share} y2={height * share} vectorEffect="non-scaling-stroke" />
          ))}
          <path className="area-chart__fill" d={area} />
          <path className="area-chart__line" d={line} vectorEffect="non-scaling-stroke" />
        </svg>
        {spot && shown && (
          <>
            <span className="area-chart__rule" style={{ insetInlineStart: `${spot.x * 100}%` }} aria-hidden="true" />
            <span className="area-chart__dot" style={{ insetInlineStart: `${spot.x * 100}%`, insetBlockStart: PAD + spot.y * plot }} aria-hidden="true" />
            <span
              id={tipId}
              className={`area-chart__tip${spot.x < 0.2 ? ' area-chart__tip--start' : spot.x > 0.8 ? ' area-chart__tip--end' : ''}`}
              style={{ insetInlineStart: `${spot.x * 100}%` }}
            >
              {shown.description}
            </span>
          </>
        )}
      </div>
      <div className="area-chart__axis" aria-hidden="true">
        {ticks.map((index) => (
          <span key={points[index]!.key}>{points[index]!.label}</span>
        ))}
      </div>
      <ol className="visually-hidden">
        {points.map((point) => (
          <li key={point.key}>{point.description}</li>
        ))}
      </ol>
    </figure>
  );
}
