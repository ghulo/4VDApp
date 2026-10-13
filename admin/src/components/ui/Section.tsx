import { useId, type ReactNode } from 'react';

interface SectionProps {
  title: ReactNode;
  description?: ReactNode;
  /** Links or buttons at the end of the heading row. */
  actions?: ReactNode;
  className?: string;
  id?: string;
  children?: ReactNode;
}

/**
 * A titled part of a page with no box around it: the heading sits on the canvas
 * and a table or list follows, framed by itself. Use this, not a Card, around a
 * DataTable (DESIGN.md 8: never a box in a box).
 */
export function Section({ title, description, actions, className, id, children }: SectionProps) {
  const headingId = useId();
  return (
    <section id={id} className={['section', className].filter(Boolean).join(' ')} aria-labelledby={headingId}>
      <div className="section__head">
        <div className="section__heading">
          <h2 id={headingId} className="section__title">
            {title}
          </h2>
          {description && <p className="section__description">{description}</p>}
        </div>
        {actions && <div className="section__actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
