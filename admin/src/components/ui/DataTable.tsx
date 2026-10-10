import { Fragment, type Key, type ReactNode } from 'react';

export interface Column<Row> {
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** Numbers line up on the right. */
  align?: 'start' | 'end';
  className?: string;
  /** On phones, where rows stack, this cell heads the row. Defaults to the first cell. */
  title?: boolean;
}

interface DataTableProps<Row> {
  /** Read out by screen readers; not shown. */
  caption: string;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => Key;
  rowClassName?: (row: Row) => string | undefined;
  /** Extra rows under a row, like an expanded detail. */
  afterRow?: (row: Row) => ReactNode;
  /** Splits the rows into runs under a heading row, e.g. one per day. Rows must already be in order. */
  group?: (row: Row) => { key: string; heading: ReactNode };
  /**
   * A click anywhere on the row (outside its links, buttons and fields) does
   * this. A mouse shortcut only: the row must still hold a button that does the same.
   */
  onRowClick?: (row: Row) => void;
  /** Search and filters above the table. */
  toolbar?: ReactNode;
  /** Shown instead of the table when there are no rows. */
  empty?: ReactNode;
  /** Under the table, usually pagination. */
  footer?: ReactNode;
}

/** A list of records in a bordered frame, with an optional toolbar and footer. */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  rowClassName,
  afterRow,
  group,
  onRowClick,
  toolbar,
  empty,
  footer,
}: DataTableProps<Row>) {
  const cellClass = (column: Column<Row>) =>
    [column.align === 'end' && 'table__numeric', column.title && 'table__title', column.className].filter(Boolean).join(' ') ||
    undefined;
  // Explicit roles: older Safari drops table semantics once rows stack with display: grid.
  // Stacked rows on phones name each value with its column; hidden headers (like actions) get none.
  const cellLabel = (column: Column<Row>) => (typeof column.header === 'string' ? column.header : undefined);

  return (
    <div className="data-table">
      {toolbar && <div className="data-table__toolbar">{toolbar}</div>}
      {rows.length === 0 ? (
        <div className="data-table__empty">{empty}</div>
      ) : (
        <div className="data-table__scroll">
          <table className="table table--stack" role="table">
            <caption className="visually-hidden">{caption}</caption>
            <thead role="rowgroup">
              <tr role="row">
                {columns.map((column, index) => (
                  <th key={index} role="columnheader" scope="col" className={cellClass(column)}>
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            {runs(rows, group).map((run) => (
              <tbody key={run.key} role="rowgroup">
                {run.heading !== undefined && (
                  <tr role="row" className="table__group">
                    <th role="rowheader" scope="rowgroup" colSpan={columns.length}>
                      {run.heading}
                    </th>
                  </tr>
                )}
                {run.rows.map((row) => (
                  <Fragment key={rowKey(row)}>
                    <tr
                      role="row"
                      className={[rowClassName?.(row), onRowClick && 'table__row--clickable'].filter(Boolean).join(' ') || undefined}
                      onClick={
                        onRowClick &&
                        ((event) => {
                          if (!(event.target as HTMLElement).closest('a, button, input, select, textarea, label')) onRowClick(row);
                        })
                      }
                    >
                      {columns.map((column, index) => (
                        <td key={index} role="cell" className={cellClass(column)} data-label={cellLabel(column)}>
                          {column.cell(row)}
                        </td>
                      ))}
                    </tr>
                    {afterRow?.(row)}
                  </Fragment>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
      {footer && <div className="data-table__footer">{footer}</div>}
    </div>
  );
}

/** Consecutive rows that share a group key; one run without a heading when there's no grouping. */
function runs<Row>(rows: Row[], group?: (row: Row) => { key: string; heading: ReactNode }) {
  if (!group) return [{ key: 'all', heading: undefined as ReactNode, rows }];
  const result: Array<{ key: string; heading: ReactNode; rows: Row[] }> = [];
  for (const row of rows) {
    const { key, heading } = group(row);
    const last = result.at(-1);
    if (last?.key === key) last.rows.push(row);
    else result.push({ key, heading, rows: [row] });
  }
  return result;
}
