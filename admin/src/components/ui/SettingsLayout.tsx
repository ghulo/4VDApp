import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Navigate, NavLink, useParams } from 'react-router';
import { useT } from '../../i18n/useT';

export interface SettingsSection {
  id: string;
  label: string;
  icon: Icon;
  /** A short state beside the label, like "3 of 8" or a dot for something to do. */
  note?: ReactNode;
  content: ReactNode;
}

/**
 * A settings page split into short pages: the list of sections stays beside
 * the one you're on, and each has its own address (/settings/carwashes), so a
 * link can open it directly. The first section is also the page's own address.
 * On a phone the list becomes a row of chips under the top bar.
 */
export function SettingsLayout({ base, sections }: { base: string; sections: SettingsSection[] }) {
  const t = useT();
  const { section: asked } = useParams();
  const active = asked ? sections.find((section) => section.id === asked) : sections[0];
  if (!active) return <Navigate to={base} replace />;

  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label={t.common.onThisPage}>
        {sections.map((section, index) => {
          const SectionIcon = section.icon;
          return (
            <NavLink
              key={section.id}
              to={index === 0 ? base : `${base}/${section.id}`}
              end
              className="settings-nav__link"
              aria-current={section === active ? 'page' : undefined}
            >
              <SectionIcon size={18} aria-hidden="true" className="settings-nav__icon" />
              <span className="settings-nav__label">{section.label}</span>
              {section.note && <span className="settings-nav__note">{section.note}</span>}
            </NavLink>
          );
        })}
      </nav>
      <div className="settings-layout__body" key={active.id}>
        {active.content}
      </div>
    </div>
  );
}
