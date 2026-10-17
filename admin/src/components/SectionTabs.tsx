import { Suspense } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Loading } from './Feedback';
import { useT } from '../i18n/useT';
import type { Catalogue } from '../i18n/en';
import { type SectionTab, shownTo } from '../navigation/sections';
import { useCurrentUser } from '../auth/useAuth';

/** Tabs over pages that share one menu item; each tab is a real link with its own address. */
export function SectionTabs({ tabs, labelKey }: { tabs: SectionTab[]; labelKey: keyof Catalogue['nav']['items'] }) {
  const t = useT();
  const label = t.nav.items[labelKey];
  const { search } = useLocation();
  const { role } = useCurrentUser();
  return (
    <>
      <nav className="section-tabs" aria-label={label}>
        {tabs.filter((tab) => shownTo(role, tab)).map((tab) => (
          <NavLink key={tab.to} to={{ pathname: tab.to, search: tab.keepSearch ? search : '' }} end className="section-tabs__tab">
            {t.nav.tabs[tab.key]}
          </NavLink>
        ))}
      </nav>
      <Suspense fallback={<Loading />}>
        <Outlet />
      </Suspense>
    </>
  );
}
