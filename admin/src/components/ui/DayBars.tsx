import { scaleTop } from './sparkline';

/** Width of one day's slot and the bar inside it, in drawing units. */
const SLOT = 8;
const BAR = 5;
const HEIGHT = 48;

/**
 * Values as a strip of slim bars, one per day, the latest in ink and the rest
 * muted, standing on one hairline. Quiet days still show a sliver; days with
 * nothing leave the line bare. One huge day doesn't flatten the rest: it runs
 * to the top with a break mark (DESIGN.md, charts).
 * The picture is for the eye; `label` says what it shows for screen readers.
 */
export function DayBars({ values, label }: { values: number[]; label: string }) {
  const { top, outlier } = scaleTop(values);
  return (
    <svg className="day-bars" viewBox={`0 0 ${values.length * SLOT} ${HEIGHT}`} role="img" aria-label={label}>
      <rect className="day-bars__base" x={0} y={HEIGHT - 1} width={values.length * SLOT} height={1} />
      {values.map((value, index) => {
        if (value <= 0 || top <= 0) return null;
        const height = Math.max(3, Math.min(1, value / top) * HEIGHT);
        const className = index === values.length - 1 ? 'day-bars__bar day-bars__bar--latest' : 'day-bars__bar';
        const x = index * SLOT + (SLOT - BAR) / 2;
        return (
          <g key={index}>
            <rect className={className} x={x} y={HEIGHT - height} width={BAR} height={height} rx={1.5} />
            {index === outlier && <rect className="day-bars__break" x={x - 1} y={8} width={BAR + 2} height={2} />}
          </g>
        );
      })}
    </svg>
  );
}
