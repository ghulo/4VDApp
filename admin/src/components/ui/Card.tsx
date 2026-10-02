import { useId, type ReactNode } from 'react';

interface CardProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Buttons or links in the top-right corner. */
  actions?: ReactNode;
  /** A strip along the bottom, usually holding Save. */
  footer?: ReactNode;
  /** No padding around the body, for tables and lists that run edge to edge. */
  flush?: boolean;
  className?: string;
  id?: string;
  children?: ReactNode;
}

/** A bordered block of related content. Settings pages are a stack of these. */
export function Card({ title, description, actions, footer, flush, className, id, children }: CardProps) {
  const headingId = useId();
  return (
    <section
      id={id}
      className={['card', flush && 'card--flush', className].filter(Boolean).join(' ')}
      aria-labelledby={title ? headingId : undefined}
    >
      {title && (
        <div className="card__head">
          <div className="card__heading">
            <h2 id={headingId} className="card__title">
              {title}
            </h2>
            {description && <p className="card__description">{description}</p>}
          </div>
          {actions && <div className="card__actions">{actions}</div>}
        </div>
      )}
      <div className="card__body">{children}</div>
      {footer && <div className="card__foot">{footer}</div>}
    </section>
  );
}

interface SettingRowProps {
  title: ReactNode;
  description?: ReactNode;
  /** The control: a switch, a select, a button. */
  children: ReactNode;
}

/** One setting inside a Card: what it is on the left, the control on the right. */
export function SettingRow({ title, description, children }: SettingRowProps) {
  return (
    <div className="setting-row">
      <div className="setting-row__text">
        <p className="setting-row__title">{title}</p>
        {description && <p className="setting-row__description">{description}</p>}
      </div>
      <div className="setting-row__control">{children}</div>
    </div>
  );
}
