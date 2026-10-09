import { NavLink, Outlet } from 'react-router';
import { useT } from '../i18n/useT';
import type { Catalogue } from '../i18n/en';
import type { SectionTab } from '../navigation/sections';

/** Tabs over pages that share one menu item; each tab is a real link with its own address. */
export function SectionTabs({ tabs, labelKey }: { tabs: SectionTab[]; labelKey: keyof Catalogue['nav']['items'] }) {
  const t = useT();
  const label = t.nav.items[labelKey];
  return (
    <>
      <nav className="section-tabs" aria-label={label}>
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end className="section-tabs__tab">
            {t.nav.tabs[tab.key]}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
