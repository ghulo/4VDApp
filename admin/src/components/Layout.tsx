import { CaretDoubleLeft, CaretDoubleRight, CaretDown, DotsThree, List, MagnifyingGlass, SignOut, UserCircle, X } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth, useCurrentUser } from '../auth/useAuth';
import { CommandPalette } from '../command/CommandPalette';
import { useShortcuts } from '../command/useShortcuts';
import { businessApi } from '../services/api';
import { useAttention } from '../utils/useAttention';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { Avatar } from './Avatar';
import { ErrorBoundary } from './ErrorBoundary';
import { Loading } from './Feedback';
import { LogoMark } from './LogoMark';
import { Button, Kbd, MenuButton, Tooltip } from './ui';
import { useSwipeToDismiss } from './ui/useSwipeToDismiss';
import { useT } from '../i18n/useT';
import { isCurrent, mainItemsFor, NAV_GROUPS, type NavItem, phoneTabsFor, shownTo } from '../navigation/sections';
import { staffLayout } from '../auth/roles';
import type { UserRole } from '../services/types';
import { StaffLayout } from './StaffLayout';
import { MAIN_ID, SkipLink, useFocusOnRouteChange } from './SkipLink';

/** Shortcut hints show ⌘ on a Mac and Ctrl elsewhere. */
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const COLLAPSED_KEY = '4vd.sidebar.collapsed';
const MORE_KEY = '4vd.sidebar.more';

function readYes(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'yes';
  } catch {
    return false;
  }
}

function saveYes(key: string, yes: boolean) {
  try {
    localStorage.setItem(key, yes ? 'yes' : 'no');
  } catch {
    // Blocked storage: remembered for this visit only.
  }
}

/** Whether the page is one of those under the owner's More. */
function underMore(role: UserRole, pathname: string): boolean {
  const main = mainItemsFor(role);
  if (!main) return false;
  return NAV_GROUPS.some((group) => group.items.some((item) => shownTo(role, item) && !main.includes(item) && isCurrent(item, pathname)));
}

/** The signed-in frame: the full dashboard, or the simple staff one for the counter staff. */
export function Layout() {
  const { role } = useCurrentUser();
  return staffLayout(role) ? <StaffLayout /> : <FullLayout />;
}

/** The full frame: a top bar, the sidebar (a drawer on phones) and the page. */
function FullLayout() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const togglePalette = useCallback(() => setPaletteOpen((open) => !open), []);
  useShortcuts(togglePalette);
  const user = useCurrentUser();
  const { logout } = useAuth();
  const location = useLocation();
  useFocusOnRouteChange();
  const navigate = useNavigate();
  const t = useT();

  const [collapsed, setCollapsed] = useState(() => readYes(COLLAPSED_KEY));
  const [moreOpen, setMoreOpen] = useState(() => readYes(MORE_KEY) || underMore(user.role, location.pathname));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    saveYes(COLLAPSED_KEY, next);
  }

  function toggleMore() {
    setMoreOpen(!moreOpen);
    saveYes(MORE_KEY, !moreOpen);
  }

  // The menu: everything, grouped by the job; or, for the owner, the pages they
  // look at, with the rest under More.
  const groups = NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => shownTo(user.role, item)) })).filter(
    (group) => group.items.length > 0,
  );
  const mainItems = mainItemsFor(user.role);
  const restGroups = mainItems
    ? groups.map((group) => ({ ...group, items: group.items.filter((item) => !mainItems.includes(item)) })).filter((group) => group.items.length > 0)
    : groups;
  const showRest = !mainItems || moreOpen;

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    menuButton.current?.focus();
  }, []);

  // On phones the drawer can be swiped back out to the left.
  const sidebar = useRef<HTMLElement>(null);
  useSwipeToDismiss(sidebar, {
    side: 'left',
    closed: 'translateX(-105%)',
    onDismiss: closeDrawer,
    enabled: drawerOpen,
    progressTarget: () => sidebar.current?.parentElement ?? null,
  });

  // Moving to another page closes the drawer on phones.
  const [lastPath, setLastPath] = useState(location.pathname);
  if (location.pathname !== lastPath) {
    setLastPath(location.pathname);
    setDrawerOpen(false);
    // A page under More opens More, so the menu shows where you are.
    if (underMore(user.role, location.pathname)) setMoreOpen(true);
  }

  // On a short screen the menu scrolls: keep the page you are on in view.
  useEffect(() => {
    sidebar.current?.querySelector('.sidebar__link.active')?.scrollIntoView({ block: 'nearest' });
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, closeDrawer]);

  // The badge counts To do items only (DESIGN.md 3.3); Updates never add to it.
  const inboxCount = useAttention().data?.count ?? 0;
  const business = useQuery({ queryKey: ['business'], queryFn: businessApi.get });

  // The top bar is plain canvas at the top of the page and turns to glass once
  // there is something underneath it to see through.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const navLink = (item: NavItem) => {
    const count = item.badge === 'inbox' ? inboxCount : 0;
    const ItemIcon = item.icon;
    const label = t.nav.items[item.key];
    const current = isCurrent(item, location.pathname);
    return (
      <Link
        key={item.to}
        to={item.to}
        className={current ? 'sidebar__link active' : 'sidebar__link'}
        aria-current={current ? 'page' : undefined}
        title={collapsed ? label : undefined}
      >
        <ItemIcon size={18} className="sidebar__icon" aria-hidden="true" />
        <span className="sidebar__label">{label}</span>
        {count > 0 && (
          <>
            <span className="sidebar__badge" aria-hidden="true">
              {count}
            </span>
            <span className="visually-hidden">{t.nav.waiting(count)}</span>
          </>
        )}
      </Link>
    );
  };

  return (
    <div className={collapsed ? 'app app--collapsed' : 'app'}>
      <SkipLink />
      <header className={scrolled ? 'topbar topbar--glass' : 'topbar'}>
        <Link to="/" className="topbar__brand" aria-label={t.nav.home}>
          <LogoMark size={36} />
        </Link>
        {business.data && business.data.name.trim().toUpperCase() !== '4VD' && (
          <>
            <span className="topbar__slash" aria-hidden="true">
              /
            </span>
            <Link to="/settings" className="topbar__shop">
              {business.data.name}
            </Link>
          </>
        )}
        <Tooltip label={t.nav.search} shortcut={isMac ? '⌘ K' : 'Ctrl K'} side="bottom">
          <button type="button" className="topbar__search" aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'} onClick={() => setPaletteOpen(true)}>
            <MagnifyingGlass size={16} aria-hidden="true" />
            <span className="topbar__search-label">{t.nav.search}</span>
            <span aria-hidden="true">
              <Kbd keys={[isMac ? '⌘' : 'Ctrl', 'K']} />
            </span>
          </button>
        </Tooltip>
        <div className="topbar__end">
          <ThemeSwitch persist compact />
          {/* Log out sits behind the avatar: a key of its own beside it was one stray click from signing out. */}
          <MenuButton
            label={t.nav.yourProfile(user.name)}
            face={<Avatar name={user.name} url={user.avatarUrl} size={30} />}
            faceClassName={location.pathname.startsWith('/profile') ? 'topbar__user active' : 'topbar__user'}
            items={[
              { label: t.nav.items.profile, icon: UserCircle, onSelect: () => navigate('/profile') },
              { label: t.nav.logOut, icon: SignOut, onSelect: logout },
            ]}
          />
        </div>
      </header>

      {/* Always there on phones so it can fade out with the drawer, not vanish before it. */}
      <div
        className={drawerOpen ? 'drawer-backdrop drawer-backdrop--open' : 'drawer-backdrop'}
        onClick={closeDrawer}
        aria-hidden="true"
      />

      <aside ref={sidebar} id="sidebar" className={drawerOpen ? 'sidebar sidebar--open' : 'sidebar'} aria-label={t.nav.mainMenu}>
        <div className="sidebar__drawer-head">
          <span className="topbar__brand">
            <LogoMark size={36} />
          </span>
          <Button variant="ghost" icon={X} aria-label={t.nav.closeMenu} onClick={closeDrawer} />
        </div>
        <nav className="sidebar__nav" aria-label={t.nav.main}>
          {mainItems && <div className="sidebar__group">{mainItems.map(navLink)}</div>}
          {mainItems && (
            <button
              type="button"
              className={showRest ? 'sidebar__link sidebar__more sidebar__more--open' : 'sidebar__link sidebar__more'}
              aria-expanded={showRest}
              aria-controls={showRest ? 'sidebar-more' : undefined}
              title={collapsed ? t.nav.more : undefined}
              onClick={toggleMore}
            >
              <DotsThree size={18} weight="bold" className="sidebar__icon" aria-hidden="true" />
              <span className="sidebar__label">{t.nav.more}</span>
              <CaretDown size={12} weight="bold" className="sidebar__more-caret" aria-hidden="true" />
            </button>
          )}
          {showRest && (
            <div id="sidebar-more" className="sidebar__rest">
              {restGroups.map((group) => (
                <div key={group.key} className="sidebar__group">
                  <p className="sidebar__group-label">{t.nav.groups[group.key]}</p>
                  {group.items.map(navLink)}
                </div>
              ))}
            </div>
          )}
        </nav>
        <Tooltip label={collapsed ? t.nav.expand : t.nav.collapseMenu} side="top">
          <button
            type="button"
            className="sidebar__collapse"
            onClick={toggleCollapsed}
            aria-label={collapsed ? t.nav.expand : t.nav.collapseMenu}
          >
            {collapsed ? <CaretDoubleRight size={16} aria-hidden="true" /> : <CaretDoubleLeft size={16} aria-hidden="true" />}
            <span className="sidebar__label">{t.nav.collapse}</span>
          </button>
        </Tooltip>
      </aside>

      <main className="main" id={MAIN_ID} tabIndex={-1}>
        <div className="main__frame">
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<Loading />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
      {/* On a phone: the pages used most along the bottom, in thumb reach; Menu opens the rest. */}
      <nav className="tab-bar" aria-label={t.nav.quickBar}>
        {phoneTabsFor(user.role).map((item) => {
          const TabIcon = item.icon;
          const current = isCurrent(item, location.pathname);
          const count = item.badge === 'inbox' ? inboxCount : 0;
          return (
            <Link key={item.to} to={item.to} className={current ? 'tab-bar__tab active' : 'tab-bar__tab'} aria-current={current ? 'page' : undefined}>
              <span className="tab-bar__icon">
                <TabIcon size={22} weight={current ? 'fill' : 'regular'} aria-hidden="true" />
                {count > 0 && (
                  <>
                    <span className="tab-bar__badge" aria-hidden="true">
                      {count}
                    </span>
                    <span className="visually-hidden">{t.nav.waiting(count)}</span>
                  </>
                )}
              </span>
              <span>{t.nav.items[item.key]}</span>
            </Link>
          );
        })}
        <button
          ref={menuButton}
          type="button"
          className={drawerOpen ? 'tab-bar__tab active' : 'tab-bar__tab'}
          aria-label={t.nav.openMenu}
          aria-expanded={drawerOpen}
          aria-controls="sidebar"
          onClick={() => setDrawerOpen(true)}
        >
          <span className="tab-bar__icon">
            <List size={22} aria-hidden="true" />
          </span>
          <span aria-hidden="true">{t.nav.menuTab}</span>
        </button>
      </nav>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
