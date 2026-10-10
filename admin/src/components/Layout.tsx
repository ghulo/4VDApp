import { CaretDoubleLeft, CaretDoubleRight, List, MagnifyingGlass, SignOut, X } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useAuth, useCurrentUser } from '../auth/useAuth';
import { CommandPalette } from '../command/CommandPalette';
import { useShortcuts } from '../command/useShortcuts';
import { approvalsApi, businessApi, notificationsApi } from '../services/api';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { Avatar } from './Avatar';
import { ErrorBoundary } from './ErrorBoundary';
import { LogoMark } from './LogoMark';
import { Button } from './ui';
import { canManage } from '../auth/roles';
import { useT } from '../i18n/useT';
import { isCurrent, NAV_GROUPS } from '../navigation/sections';

/** Shortcut hints show ⌘ on a Mac and Ctrl elsewhere. */
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const ALERT_POLL_MS = 60_000;
const COLLAPSED_KEY = '4vd.sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'yes';
  } catch {
    return false;
  }
}

/** The signed-in frame: a top bar, the sidebar (a drawer on phones) and the page. */
export function Layout() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const togglePalette = useCallback(() => setPaletteOpen((open) => !open), []);
  useShortcuts(togglePalette);
  const user = useCurrentUser();
  const { logout } = useAuth();
  const location = useLocation();
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

  // Moving to another page closes the drawer on phones.
  const [lastPath, setLastPath] = useState(location.pathname);
  if (location.pathname !== lastPath) {
    setLastPath(location.pathname);
    setDrawerOpen(false);
  }

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, closeDrawer]);

  // Poll so a low-stock alert from an employee's sale shows up without a reload.
  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => (await notificationsApi.list(1, true)).unreadCount,
    refetchInterval: ALERT_POLL_MS,
  });
  const unreadCount = unread.data ?? 0;
  const approvals = useQuery({
    queryKey: ['approvals', 'summary'],
    queryFn: approvalsApi.summary,
    refetchInterval: ALERT_POLL_MS,
  });
  const inboxCount = (approvals.data?.total ?? 0) + unreadCount;
  const business = useQuery({ queryKey: ['business'], queryFn: businessApi.get });

  return (
    <div className={collapsed ? 'app app--collapsed' : 'app'}>
      <header className="topbar">
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
        <Link to="/" className="topbar__brand" aria-label={t.nav.home}>
          <LogoMark size={28} />
          <span className="topbar__name">4VD</span>
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
        <button type="button" className="topbar__search" onClick={() => setPaletteOpen(true)}>
          <MagnifyingGlass size={16} aria-hidden="true" />
          <span className="topbar__search-label">{t.nav.search}</span>
          <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
        </button>
        <div className="topbar__end">
          <ThemeSwitch persist compact />
          <NavLink to="/profile" className="topbar__user" aria-label={t.nav.yourProfile(user.name)}>
            <Avatar name={user.name} url={user.avatarUrl} size={28} />
          </NavLink>
          <Button variant="ghost" icon={SignOut} aria-label={t.nav.logOut} title={t.nav.logOut} onClick={logout} />
        </div>
      </header>

      {drawerOpen && <div className="drawer-backdrop" onClick={closeDrawer} aria-hidden="true" />}

      <aside id="sidebar" className={drawerOpen ? 'sidebar sidebar--open' : 'sidebar'} aria-label={t.nav.mainMenu}>
        <div className="sidebar__drawer-head">
          <span className="topbar__brand">
            <LogoMark size={28} />
            <span className="topbar__name">4VD</span>
          </span>
          <Button variant="ghost" icon={X} aria-label={t.nav.closeMenu} onClick={closeDrawer} />
        </div>
        <nav className="sidebar__nav" aria-label={t.nav.main}>
          {NAV_GROUPS.map((group) => (
            <div key={group.key} className="sidebar__group">
              <p className="sidebar__group-label">{t.nav.groups[group.key]}</p>
              {group.items.filter((item) => !item.managersOnly || canManage(user.role)).map((item) => {
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
        <button
          type="button"
          className="sidebar__collapse"
          onClick={toggleCollapsed}
          aria-label={collapsed ? t.nav.expand : t.nav.collapseMenu}
          title={collapsed ? t.nav.expand : t.nav.collapseMenu}
        >
          {collapsed ? <CaretDoubleRight size={16} aria-hidden="true" /> : <CaretDoubleLeft size={16} aria-hidden="true" />}
          <span className="sidebar__label">{t.nav.collapse}</span>
        </button>
      </aside>

      <main className="main">
        <div className="main__frame">
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
