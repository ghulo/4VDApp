import type { ReactNode } from 'react';
import { Link } from 'react-router';

export interface BarItem {
  key: string | number;
  label: ReactNode;
  value: number;
  /** The value as shown, e.g. "€1,200". */
  display: string;
  /** A second line under the label, e.g. units and profit. */
  detail?: ReactNode;
  /** Makes the label a link, e.g. to the product. */
  to?: string;
}

/**
 * One series as labelled horizontal bars, longest first as given: reads at
 * phone width, and each value is printed at its bar's end, so nothing depends
 * on colour or hover. Below zero is hatched in the loss colour.
 */
export function BarList({ items, label }: { items: BarItem[]; label: string }) {
  const max = Math.max(...items.map((item) => Math.abs(item.value)), 0);
  return (
    <ul className="bar-list" aria-label={label}>
      {items.map((item) => (
        <li key={item.key} className="bar-list__row">
          <span className="bar-list__label">
            {item.to ? (
              <Link to={item.to} className="table__primary-link">
                {item.label}
              </Link>
            ) : (
              item.label
            )}
            {item.detail && <span className="bar-list__detail">{item.detail}</span>}
          </span>
          <span className="bar-list__track" aria-hidden="true">
            <span
              className={`bar-list__bar${item.value < 0 ? ' bar-list__bar--negative' : ''}`}
              style={{ inlineSize: max > 0 && item.value !== 0 ? `${Math.max(1, (Math.abs(item.value) / max) * 100)}%` : '0%' }}
            />
          </span>
          <span className="bar-list__value">{item.display}</span>
        </li>
      ))}
    </ul>
  );
}
