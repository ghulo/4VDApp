import { CaretDown } from '@phosphor-icons/react';
import { Fragment, type Key, type ReactNode, useMemo, useState } from 'react';
import { useLanguage } from '../../i18n/useT';

export interface Column<Row> {
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** Numbers line up on the right. */
  align?: 'start' | 'end';
  className?: string;
  /** On phones, where rows stack, this cell heads the row. Defaults to the first cell. */
  title?: boolean;
  /** The words beside the cell on phones, when the header is more than text. */
  label?: string;
  /**
   * What the column sorts by when its header is clicked: a plain value, never the
   * drawn cell. Columns without it can't be sorted. Blank values go last either way.
   */
  sortValue?: (row: Row) => string | number | null | undefined;
  /** The first click sorts this way: 'desc' for money and dates (biggest, newest first). Default 'asc'. */
  sortFirst?: SortDirection;
}

export type SortDirection = 'asc' | 'desc';
/** Which column the rows are in order by, by its index in `columns`. */
export interface TableSort {
  column: number;
  direction: SortDirection;
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
  /** A totals row under the last row, one cell per column (empty cells stay blank). */
  totals?: ReactNode[];
  /** Ledger rows: tighter, for long lists read on a computer. Phones stack rows as usual. */
  density?: 'comfortable' | 'compact';
  /** Starting order, for a table that sorts its own rows (columns with `sortValue`). */
  defaultSort?: TableSort;
  /**
   * For lists the server pages (Sales, Stock): the order is held outside and the
   * rows come back already in it. With these, the table never reorders rows itself.
   */
  sort?: TableSort | null;
  onSortChange?: (sort: TableSort | null) => void;
  /**
   * Column labels stay at the top of the screen while the page scrolls (computers only).
   * Only for tables no wider than the page: the frame stops scrolling sideways.
   */
  stickyHeader?: boolean;
}

/** A cell with nothing to say: stacked rows on phones leave it out instead of printing "–". */
const isBlank = (content: ReactNode) => content === null || content === undefined || content === false || content === '' || content === '–';

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
  totals,
  density = 'comfortable',
  defaultSort,
  sort: heldSort,
  onSortChange,
  stickyHeader = false,
}: DataTableProps<Row>) {
  const { language } = useLanguage();
  const held = onSortChange !== undefined;
  const [ownSort, setOwnSort] = useState<TableSort | null>(defaultSort ?? null);
  const sort = held ? (heldSort ?? null) : ownSort;
  // Rows split under day headings keep their order (sorting here would scatter the runs),
  // unless the page holds the sort: then it orders the rows itself, often on the server.
  const sortable = (column: Column<Row>) => column.sortValue !== undefined && (held || !group);
  const ordered = useMemo(() => {
    if (held || !sort || group) return rows;
    const column = columns[sort.column];
    if (!column?.sortValue) return rows;
    return sortRows(rows, column.sortValue, sort.direction, language);
  }, [rows, columns, sort, held, group, language]);
  const nextSort = (index: number): TableSort | null => {
    const first = columns[index].sortFirst ?? 'asc';
    if (sort?.column !== index) return { column: index, direction: first };
    // A third click goes back to the list's own order.
    if (sort.direction === first) return { column: index, direction: first === 'asc' ? 'desc' : 'asc' };
    return null;
  };
  const pickSort = (index: number) => {
    const next = nextSort(index);
    if (held) onSortChange(next);
    else setOwnSort(next);
  };
  const cellClass = (column: Column<Row>) =>
    [column.align === 'end' && 'table__numeric', column.title && 'table__title', column.className].filter(Boolean).join(' ') ||
    undefined;
  // Explicit roles: older Safari drops table semantics once rows stack with display: grid.
  // Stacked rows on phones name each value with its column; hidden headers (like actions) get none.
  const cellLabel = (column: Column<Row>) => column.label ?? (typeof column.header === 'string' ? column.header : undefined);

  return (
    <div className={['data-table', density === 'compact' && 'data-table--compact', stickyHeader && 'data-table--sticky'].filter(Boolean).join(' ')}>
      {toolbar && <div className="data-table__toolbar">{toolbar}</div>}
      {rows.length === 0 ? (
        <div className="data-table__empty">{empty}</div>
      ) : (
        <div className="data-table__scroll">
          <table className="table table--stack" role="table">
            <caption className="visually-hidden">{caption}</caption>
            <thead role="rowgroup">
              <tr role="row">
                {columns.map((column, index) => {
                  const by = sort?.column === index ? sort.direction : undefined;
                  return (
                    <th
                      key={index}
                      role="columnheader"
                      scope="col"
                      className={cellClass(column)}
                      aria-sort={sortable(column) ? (by === 'asc' ? 'ascending' : by === 'desc' ? 'descending' : 'none') : undefined}
                    >
                      {sortable(column) ? (
                        <button type="button" className="table__sort" data-by={by} onClick={() => pickSort(index)}>
                          {column.header}
                          <CaretDown className="table__sort-mark" size={12} weight="bold" aria-hidden="true" />
                        </button>
                      ) : (
                        column.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            {runs(ordered, group).map((run) => (
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
                      {columns.map((column, index) => {
                        const content = column.cell(row);
                        return (
                          <td key={index} role="cell" className={cellClass(column)} data-label={cellLabel(column)} data-empty={isBlank(content) || undefined}>
                            {content}
                          </td>
                        );
                      })}
                    </tr>
                    {afterRow?.(row)}
                  </Fragment>
                ))}
              </tbody>
            ))}
            {totals && (
              <tfoot role="rowgroup">
                <tr role="row" className="table__totals">
                  {columns.map((column, index) => (
                    <td key={index} role="cell" className={cellClass(column)} data-label={cellLabel(column)} data-empty={isBlank(totals[index]) || undefined}>
                      {totals[index]}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
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

/** Rows in order by one value: names the way the reader's language sorts them, numbers by size, blanks last both ways. */
export function sortRows<Row>(
  rows: Row[],
  value: (row: Row) => string | number | null | undefined,
  direction: SortDirection,
  language: string,
): Row[] {
  const collator = new Intl.Collator(language, { numeric: true, sensitivity: 'base' });
  const flip = direction === 'asc' ? 1 : -1;
  return rows
    .map((row, at) => ({ row, at, key: value(row) }))
    .sort((a, b) => {
      const blankA = a.key === null || a.key === undefined || a.key === '';
      const blankB = b.key === null || b.key === undefined || b.key === '';
      if (blankA || blankB) return blankA === blankB ? a.at - b.at : blankA ? 1 : -1;
      const order =
        typeof a.key === 'number' && typeof b.key === 'number' ? a.key - b.key : collator.compare(String(a.key), String(b.key));
      // Equal values keep the list's own order.
      return order === 0 ? a.at - b.at : order * flip;
    })
    .map((entry) => entry.row);
}
