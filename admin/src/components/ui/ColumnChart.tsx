export interface ChartColumn {
  key: string | number;
  /** Under the column, e.g. "Mon" or "14". */
  label: string;
  /** Read out and shown on hover, e.g. "Monday: €120 on average". */
  description: string;
  value: number;
}

/**
 * One series as upright columns over a short axis, for a pattern over the
 * week or the day. The tallest column is drawn in ink to say "the busiest";
 * hovering a column shows its figure. Screen readers get each column as a
 * line of text, so the picture is never the only way in.
 */
export function ColumnChart({ columns, label }: { columns: ChartColumn[]; label: string }) {
  const max = Math.max(...columns.map((column) => column.value), 0);
  return (
    <ol className="column-chart" aria-label={label} style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
      {columns.map((column) => (
        <li key={column.key} className="column-chart__slot">
          <span className="column-chart__track" aria-hidden="true">
            <span
              className={`column-chart__bar${max > 0 && column.value === max ? ' column-chart__bar--top' : ''}`}
              style={{ blockSize: max > 0 && column.value > 0 ? `${Math.max(2, (column.value / max) * 100)}%` : '0%' }}
            />
            <span className="column-chart__tip">{column.description}</span>
          </span>
          <span className="column-chart__label" aria-hidden="true">
            {column.label}
          </span>
          <span className="visually-hidden">{column.description}</span>
        </li>
      ))}
    </ol>
  );
}
