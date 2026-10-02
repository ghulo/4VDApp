import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

/** Figures side by side in cells that share their borders, with corner nodes. */
export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div className="stat-grid-frame nodes">
      <div className="stat-grid">{children}</div>
    </div>
  );
}

interface StatTileProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: Icon;
  tone?: 'default' | 'warn' | 'danger';
  /** Makes the whole tile a link to the page behind the figure. */
  to?: string;
}

export function StatTile({ label, value, hint, icon: IconComponent, tone = 'default', to }: StatTileProps) {
  const body = (
    <>
      <span className="stat__label">
        {IconComponent && <IconComponent size={16} aria-hidden="true" />}
        {label}
      </span>
      <span className="stat__value">{value}</span>
      {hint && <span className="stat__hint">{hint}</span>}
    </>
  );
  const className = `stat stat--${tone}`;
  return to ? (
    <Link to={to} className={`${className} stat--link`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
