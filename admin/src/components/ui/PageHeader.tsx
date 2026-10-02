import { CaretRight } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

export interface Crumb {
  label: string;
  to: string;
}

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** The pages above this one; this page's title is added at the end. */
  crumbs?: Crumb[];
  /** Buttons for the page's main actions, shown on the right. */
  actions?: ReactNode;
  /** Small things next to the title, like a status badge. */
  meta?: ReactNode;
}

/** The top of every page: where you are, what it is, what you can do. */
export function PageHeader({ title, description, crumbs, actions, meta }: PageHeaderProps) {
  return (
    <header className="page-header">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="crumbs">
          <ol>
            {crumbs.map((crumb) => (
              <li key={crumb.to}>
                <Link to={crumb.to}>{crumb.label}</Link>
                <CaretRight size={12} aria-hidden="true" />
              </li>
            ))}
            <li aria-current="page">{title}</li>
          </ol>
        </nav>
      )}
      <div className="page-header__row">
        <div className="page-header__text">
          <div className="page-header__title-row">
            <h1 className="page-header__title">{title}</h1>
            {meta}
          </div>
          {description && <p className="page-header__description">{description}</p>}
        </div>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
    </header>
  );
}
