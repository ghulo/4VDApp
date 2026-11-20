import { Suspense } from 'react';
import { lazyNamed } from '../../utils/lazyNamed';

const ColumnView = lazyNamed(() => import('./charts/RechartsViews'), 'ColumnView');

export interface ChartColumn {
  key: string | number;
  /** Under the column, e.g. "Mon" or "14". */
  label: string;
  /** Read out and shown on hover, e.g. "Monday: €120 on average". */
  description: string;
  value: number;
}

/** Plot height plus the labels under it. */
const HEIGHT = 168;

/**
 * One series as upright columns over a short axis, for a pattern over the
 * week or the day. The tallest column is drawn in the strong amber to say
 * "the busiest"; pointing at a column shows its figure and lets the others
 * step back. Screen readers get each column as a line of text, so the picture
 * is never the only way in. One column far taller than the rest runs to the
 * top with a break, so the others keep their shape. Drawn by Recharts in
 * 4VD's look (charts/RechartsViews.tsx), loaded only when a page shows one.
 */
export function ColumnChart({ columns, label }: { columns: ChartColumn[]; label: string }) {
  return (
    <figure className="column-chart" aria-label={label}>
      <div className="column-chart__plot" aria-hidden="true" style={{ minBlockSize: HEIGHT }}>
        <Suspense fallback={null}>
          <ColumnView columns={columns} height={HEIGHT} />
        </Suspense>
      </div>
      <ol className="visually-hidden">
        {columns.map((column) => (
          <li key={column.key}>{column.description}</li>
        ))}
      </ol>
    </figure>
  );
}
