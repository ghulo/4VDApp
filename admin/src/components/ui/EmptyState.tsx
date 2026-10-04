import type { ReactNode } from 'react';
import { PixelArt } from './PixelArt';
import { ShopSunrise } from './ShopSunrise';
import type { PixelArtName } from './pixelDrawings';

interface EmptyStateProps {
  title: string;
  /** What to do next, in a sentence. */
  children?: ReactNode;
  action?: ReactNode;
  /** Draws the dithered shop above the words, for big empty pages. */
  art?: boolean;
  /** The job's blocky pictogram above the words, for lists of that job. */
  pictogram?: PixelArtName;
}

/** An empty list says what would be here and how to get it there. */
export function EmptyState({ title, children, action, art, pictogram }: EmptyStateProps) {
  return (
    <div className={art ? 'empty-state empty-state--art' : 'empty-state'}>
      {art && (
        <div className="empty-state__art">
          <ShopSunrise />
        </div>
      )}
      {pictogram && !art && <PixelArt name={pictogram} className="empty-state__pictogram" />}
      <p className="empty-state__title">{title}</p>
      {children && <div className="empty-state__body">{children}</div>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}
