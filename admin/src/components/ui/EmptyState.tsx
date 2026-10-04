import type { ReactNode } from 'react';
import type { Icon } from '@phosphor-icons/react';
import { ShopSunrise } from './ShopSunrise';

interface EmptyStateProps {
  title: string;
  /** What to do next, in a sentence. */
  children?: ReactNode;
  action?: ReactNode;
  /** Draws the shop at sunrise above the words, for big empty pages. */
  art?: boolean;
  /** The job's icon above the words, in a soft chip, for lists of that job. */
  icon?: Icon;
}

/** An empty list says what would be here and how to get it there. */
export function EmptyState({ title, children, action, art, icon: JobIcon }: EmptyStateProps) {
  return (
    <div className={art ? 'empty-state empty-state--art' : 'empty-state'}>
      {art && (
        <div className="empty-state__art">
          <ShopSunrise />
        </div>
      )}
      {JobIcon && !art && (
        <span className="empty-state__icon" aria-hidden="true">
          <JobIcon size={22} />
        </span>
      )}
      <p className="empty-state__title">{title}</p>
      {children && <div className="empty-state__body">{children}</div>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}
