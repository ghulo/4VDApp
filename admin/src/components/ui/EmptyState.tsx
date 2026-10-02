import type { ReactNode } from 'react';
import { Halftone } from './Halftone';

interface EmptyStateProps {
  title: string;
  /** What to do next, in a sentence. */
  children?: ReactNode;
  action?: ReactNode;
  /** Draws the halftone building above the words, for big empty pages. */
  art?: boolean;
}

/** An empty list says what would be here and how to get it there. */
export function EmptyState({ title, children, action, art }: EmptyStateProps) {
  return (
    <div className={art ? 'empty-state empty-state--art' : 'empty-state'}>
      {art && (
        <div className="empty-state__art">
          <Halftone />
        </div>
      )}
      <p className="empty-state__title">{title}</p>
      {children && <div className="empty-state__body">{children}</div>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}
