/** Width of one day's slot and the bar inside it, in drawing units. */
const SLOT = 8;
const BAR = 5;
const HEIGHT = 48;

/**
 * Values as a strip of slim bars, one per day, the latest in ink and the rest
 * muted. Quiet days still show a sliver; days with nothing show a faint tick.
 * The picture is for the eye; `label` says what it shows for screen readers.
 */
export function DayBars({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(...values, 0);
  return (
    <svg className="day-bars" viewBox={`0 0 ${values.length * SLOT} ${HEIGHT}`} role="img" aria-label={label}>
      {values.map((value, index) => {
        const height = value > 0 && max > 0 ? Math.max(3, (value / max) * HEIGHT) : 1.5;
        const className = value <= 0 ? 'day-bars__empty' : index === values.length - 1 ? 'day-bars__bar day-bars__bar--latest' : 'day-bars__bar';
        return <rect key={index} className={className} x={index * SLOT + (SLOT - BAR) / 2} y={HEIGHT - height} width={BAR} height={height} rx={1.5} />;
      })}
    </svg>
  );
}
