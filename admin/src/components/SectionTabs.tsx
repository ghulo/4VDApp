import { CaretDown } from '@phosphor-icons/react';
import { Suspense } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Loading } from './Feedback';
import { useT } from '../i18n/useT';
import type { Catalogue } from '../i18n/en';
import { type SectionTab, shownTo } from '../navigation/sections';
import { useCurrentUser } from '../auth/useAuth';
import { MenuButton } from './ui';
import { TabsSlotContext, useTabsSlotOwner } from './ui/tabsSlot';

/**
 * Tabs over pages that share one menu item; each tab is a real link with its
 * own address. The page's header shows them under its title; a page without
 * one gets them at the top. Tabs opened now and then (setup, year end) wait
 * under More at the end of the row, unless one of them is the page you are on.
 */
export function SectionTabs({ tabs, labelKey }: { tabs: SectionTab[]; labelKey: keyof Catalogue['nav']['items'] }) {
  const t = useT();
  const label = t.nav.items[labelKey];
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { role } = useCurrentUser();
  const shown = tabs.filter((tab) => shownTo(role, tab));
  const inRow = shown.filter((tab) => !tab.rare || tab.to === pathname);
  const later = shown.filter((tab) => tab.rare && tab.to !== pathname);
  const to = (tab: SectionTab) => ({ pathname: tab.to, search: tab.keepSearch ? search : '' });
  const nav = (
    <nav className="section-tabs" aria-label={label}>
      <div className="section-tabs__row">
        {inRow.map((tab) => (
          <NavLink key={tab.to} to={to(tab)} end className="section-tabs__tab">
            {t.nav.tabs[tab.key]}
          </NavLink>
        ))}
      </div>
      {later.length > 0 && (
        <MenuButton
          label={t.nav.more}
          face={
            <>
              {t.nav.more}
              <CaretDown size={12} weight="bold" aria-hidden="true" />
            </>
          }
          faceClassName="section-tabs__tab section-tabs__more"
          tooltip={false}
          items={later.map((tab) => ({ label: t.nav.tabs[tab.key], onSelect: () => navigate(to(tab)) }))}
        />
      )}
    </nav>
  );
  const slot = useTabsSlotOwner(nav);
  return (
    <TabsSlotContext value={slot}>
      {slot.owner === null && nav}
      <Suspense fallback={<Loading />}>
        <Outlet />
      </Suspense>
    </TabsSlotContext>
  );
}
