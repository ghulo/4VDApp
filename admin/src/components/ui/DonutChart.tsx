import { useState } from 'react';
import { useT } from '../../i18n/useT';
import { formatPercent } from '../../utils/format';

export interface DonutSlice {
  key: string | number;
  label: string;
  value: number;
  /** The value as shown, e.g. "€1 240". */
  display: string;
}

/** Slices drawn at most; the rest become "Other". More steps of one colour than this can't be told apart. */
const MOST = 5;
/** Amber steps from the biggest slice down; "Other" is the faintest. */
const SHADES = [1, 2, 3, 4, 5].map((step) => `var(--data-${step})`);

/** The biggest slices, the rest added up as one "Other" slice. */
export function donutSlices(slices: DonutSlice[], otherLabel: string, formatOther: (value: number) => string): DonutSlice[] {
  const sorted = [...slices].filter((slice) => slice.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= MOST) return sorted;
  const rest = sorted.slice(MOST - 1).reduce((sum, slice) => sum + slice.value, 0);
  return [...sorted.slice(0, MOST - 1), { key: 'other', label: otherLabel, value: rest, display: formatOther(rest) }];
}

const RADIUS = 40;
const CIRCLE = 2 * Math.PI * RADIUS;
/** Paper between slices, in the circle's units. */
const GAP = 1.2;

/**
 * Parts of one whole (sales by how paid, costs by kind) as a ring in steps
 * of the brand amber, the total in the middle and a legend that carries the figures. Five
 * parts at most; smaller ones join "Other". The legend is the data for
 * screen readers; pointing at a row lights its slice.
 */
export function DonutChart({ slices, label, total, formatOther }: { slices: DonutSlice[]; label: string; total: string; formatOther: (value: number) => string }) {
  const t = useT();
  const [active, setActive] = useState<string | number | null>(null);
  const shown = donutSlices(slices, t.kit.other, formatOther);
  const sum = shown.reduce((acc, slice) => acc + slice.value, 0);
  let start = 0;
  return (
    <figure className="donut" aria-label={label}>
      <div className="donut__ring">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle className="donut__track" cx="50" cy="50" r={RADIUS} />
          {sum > 0 &&
            shown.map((slice, index) => {
              const length = (slice.value / sum) * CIRCLE;
              const dash = Math.max(0, length - (shown.length > 1 ? GAP : 0));
              const arc = (
                <circle
                  key={slice.key}
                  className={active === null || active === slice.key ? 'donut__slice' : 'donut__slice donut__slice--dim'}
                  cx="50"
                  cy="50"
                  r={RADIUS}
                  style={{ stroke: SHADES[index] }}
                  strokeDasharray={`${dash} ${CIRCLE - dash}`}
                  strokeDashoffset={-start}
                />
              );
              start += length;
              return arc;
            })}
        </svg>
        <p className="donut__total">
          <span className="donut__figure">{total}</span>
          <span className="donut__caption">{t.common.total}</span>
        </p>
      </div>
      <ul className="donut__legend">
        {shown.map((slice, index) => (
          <li key={slice.key} className="donut__row" onPointerEnter={() => setActive(slice.key)} onPointerLeave={() => setActive(null)}>
            <span className="donut__swatch" style={{ background: SHADES[index] }} aria-hidden="true" />
            <span className="donut__label">{slice.label}</span>
            <span className="donut__value">{slice.display}</span>
            <span className="donut__share">{formatPercent(sum > 0 ? slice.value / sum : 0)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
