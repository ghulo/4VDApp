import { CaretDoubleLeft, CaretDoubleRight, List, MagnifyingGlass, SignOut, UserCircle, X } from '@phosphor-icons/react';
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
import { Wordmark } from './LogoMark';
import { Button, Kbd, MenuButton, Tooltip } from './ui';
import { useSwipeToDismiss } from './ui/useSwipeToDismiss';
import { useT } from '../i18n/useT';
import { isCurrent, NAV_GROUPS, shownTo } from '../navigation/sections';
import { staffLayout } from '../auth/roles';
import { StaffLayout } from './StaffLayout';
import { MAIN_ID, SkipLink, useFocusOnRouteChange } from './SkipLink';

/** Shortcut hints show ⌘ on a Mac and Ctrl elsewhere. */
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const COLLAPSED_KEY = '4vd.sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'yes';
  } catch {
    return false;
  }
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

  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? 'yes' : 'no');
    } catch {
      // Blocked storage: remembered for this visit only.
    }
  }

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

  return (
    <div className={collapsed ? 'app app--collapsed' : 'app'}>
      <SkipLink />
      <header className={scrolled ? 'topbar topbar--glass' : 'topbar'}>
        <Tooltip label={t.nav.openMenu} side="bottom">
          <button
            ref={menuButton}
            type="button"
            className="button button--ghost button--icon topbar__menu"
            aria-label={t.nav.openMenu}
            aria-expanded={drawerOpen}
            aria-controls="sidebar"
            onClick={() => setDrawerOpen(true)}
          >
            <List size={20} aria-hidden="true" />
          </button>
        </Tooltip>
        <Link to="/" className="topbar__brand" aria-label={t.nav.home}>
          <Wordmark />
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
            <Wordmark />
          </span>
          <Button variant="ghost" icon={X} aria-label={t.nav.closeMenu} onClick={closeDrawer} />
        </div>
        <nav className="sidebar__nav" aria-label={t.nav.main}>
          {NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => shownTo(user.role, item)) }))
            .filter((group) => group.items.length > 0)
            .map((group) => (
            <div key={group.key} className="sidebar__group">
              <p className="sidebar__group-label">{t.nav.groups[group.key]}</p>
              {group.items.map((item) => {
                const count = item.badge === 'inbox' ? inboxCount : 0;
                const ItemIcon = item.icon;
                const label = t.nav.items[item.key];
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={isCurrent(item, location.pathname) ? 'sidebar__link active' : 'sidebar__link'}
                    aria-current={isCurrent(item, location.pathname) ? 'page' : undefined}
                    title={collapsed ? label : undefined}
                  >
                    <ItemIcon size={18} className="sidebar__icon" aria-hidden="true" />
                    <span className="sidebar__label">{label}</span>
                    {count > 0 && (
                      <span
                        className="sidebar__badge"
                        aria-label={t.nav.waiting(count)}
                      >
                        {count}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
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
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
