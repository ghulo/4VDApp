import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

/** Figures side by side in cells that share their borders. */
export function StatGrid({ children, compact }: { children: ReactNode; /** One slim strip of figures over a ledger, instead of tall tiles. */ compact?: boolean }) {
  return <div className={compact ? 'stat-grid stat-grid--compact' : 'stat-grid'}>{children}</div>;
}

interface StatTileProps {
  label: string;
  /** The label is the name of a thing (a till, a bank account), not a spec label: body type, not monospace capitals. */
  named?: boolean;
  value: ReactNode;
  /**
   * A calm sentence in place of the figure ("None low", "Not entered yet"):
   * body text, so a zero or a missing figure never shouts (DESIGN.md 3.3).
   */
  words?: ReactNode;
  hint?: ReactNode;
  /** Kept so screens can still pass one; tiles no longer draw it (a label needs no picture). */
  icon?: Icon;
  tone?: 'default' | 'warn' | 'danger';
  /** Makes the whole tile a link to the page behind the figure. */
  to?: string;
}

export function StatTile({ label, value, words, hint, tone = 'default', to, named }: StatTileProps) {
  const body = (
    <>
      <span className={named ? 'stat__label stat__label--name' : 'stat__label'}>
        {label}
      </span>
      {words ? <span className="stat__words">{words}</span> : <span className="stat__value">{value}</span>}
      {hint && <span className="stat__hint">{hint}</span>}
    </>
  );
  // A tile that only says "None low" steps back, so the real figures stand out.
  const className = words ? `stat stat--${tone} stat--quiet` : `stat stat--${tone}`;
  return to ? (
    <Link to={to} className={`${className} stat--link`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
