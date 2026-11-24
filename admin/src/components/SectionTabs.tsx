import { CaretDown } from '@phosphor-icons/react';
import { Suspense } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Loading } from './Feedback';
import { useT } from '../i18n/useT';
import type { Catalogue } from '../i18n/en';
import { type SectionTab, shownTo, tabSearch } from '../navigation/sections';
import { useCurrentUser } from '../auth/useAuth';
import { useLocations } from '../utils/useLocations';
import { useFeatures } from '../utils/useFeatures';
import { useSetUp } from '../auth/useSetUp';
import { ButtonLink, EmptyState, MenuButton, PageHeader } from './ui';
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
  const { several } = useLocations();
  const features = useFeatures();
  const setUp = useSetUp();
  // A shop with one location never sees Move stock, unless a link brought you to it.
  const shown = tabs.filter((tab) => shownTo(role, tab) && (!tab.locations || several || tab.to === pathname) && (!tab.feature || features[tab.feature] || tab.to === pathname) && (!tab.setUp || setUp[tab.setUp] || tab.to === pathname));
  // A page this role isn't given (a link or a typed address led here): say so, instead of loading it and being refused.
  const current = tabs.find((tab) => tab.to === pathname);
  const notForRole = current !== undefined && !shownTo(role, current);
  const inRow = shown.filter((tab) => !tab.rare || tab.to === pathname);
  const later = shown.filter((tab) => tab.rare && tab.to !== pathname);
  const to = (tab: SectionTab) => ({ pathname: tab.to, search: tabSearch(tab, search) });
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
      {notForRole ? (
        <>
          <PageHeader title={label} />
          <EmptyState title={t.nav.notForRole.title} action={<ButtonLink to="/">{t.nav.notForRole.home}</ButtonLink>}>
            {t.nav.notForRole.body}
          </EmptyState>
        </>
      ) : (
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      )}
    </TabsSlotContext>
  );
}
