import { lazy, Suspense, useState } from 'react';
import { useT } from '../../i18n/useT';
import { formatPercent } from '../../utils/format';

const RingView = lazy(() => import('./charts/RechartsViews').then((module) => ({ default: module.RingView })));

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
  return (
    <figure className="donut" aria-label={label}>
      <div className="donut__ring">
        <div className="donut__plot" aria-hidden="true">
          <Suspense fallback={null}>
            <RingView slices={sum > 0 ? shown : []} shades={SHADES} active={active} onActive={setActive} />
          </Suspense>
        </div>
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
