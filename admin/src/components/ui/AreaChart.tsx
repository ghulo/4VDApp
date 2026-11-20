import { Suspense } from 'react';
import { lazyNamed } from '../../utils/lazyNamed';
import type { ChartColumn } from './ColumnChart';

const AreaView = lazyNamed(() => import('./charts/RechartsViews'), 'AreaView');

/**
 * One series over time as a smooth line over a faint amber fill: a month of
 * days, a year of months, with a value axis and a hairline grid. Pointing at
 * it shows each point's figure; screen readers get every point as a line of
 * text. Drawn by Recharts in 4VD's look (charts/RechartsViews.tsx), loaded
 * only when a page shows one.
 */
export function AreaChart({ points, label, height = 180, formatValue }: { points: ChartColumn[]; label: string; height?: number; formatValue?: (value: number) => string }) {
  return (
    <figure className="area-chart" aria-label={label}>
      <div className="area-chart__plot" aria-hidden="true" style={{ minBlockSize: height }}>
        <Suspense fallback={null}>
          <AreaView points={points} height={height} formatValue={formatValue} />
        </Suspense>
      </div>
      <ol className="visually-hidden">
        {points.map((point) => (
          <li key={point.key}>{point.description}</li>
        ))}
      </ol>
    </figure>
  );
}
