import { SignOut } from '@phosphor-icons/react';
import { Suspense } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useAuth, useCurrentUser } from '../auth/useAuth';
import { useT } from '../i18n/useT';
import { STAFF_TABS, staffTabFor } from '../navigation/staff';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { Avatar } from './Avatar';
import { ErrorBoundary } from './ErrorBoundary';
import { Loading } from './Feedback';
import { Wordmark } from './LogoMark';
import { Button } from './ui';
import { MAIN_ID, SkipLink, useFocusOnRouteChange } from './SkipLink';

/**
 * The staff frame: what the team app was, inside the dashboard. A slim top
 * bar, the page, and four tabs (Home, Products, Sell, Account): along the
 * bottom on a phone, in the top bar on a wider screen.
 */
export function StaffLayout() {
  const user = useCurrentUser();
  const { logout } = useAuth();
  const location = useLocation();
  useFocusOnRouteChange();
  const t = useT();
  const current = staffTabFor(location.pathname);

  const tabs = (
    <nav className="staff-tabs" aria-label={t.staff.tabBar}>
      {STAFF_TABS.map((tab) => {
        const TabIcon = tab.icon;
        const active = current === tab.to;
        return (
          <Link key={tab.to} to={tab.to} className={active ? 'staff-tabs__tab active' : 'staff-tabs__tab'} aria-current={active ? 'page' : undefined}>
            <TabIcon size={22} weight={active ? 'fill' : 'regular'} aria-hidden="true" />
            <span>{t.staff.nav[tab.key]}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="staff-app">
      <SkipLink />
      <header className="topbar staff-app__top">
        <Link to="/" className="topbar__brand" aria-label={t.nav.home}>
          <Wordmark />
        </Link>
        <div className="staff-app__wide-tabs">{tabs}</div>
        <div className="topbar__end">
          <ThemeSwitch persist compact />
          <NavLink to="/profile" className="topbar__user" aria-label={t.nav.yourProfile(user.name)}>
            <Avatar name={user.name} url={user.avatarUrl} size={28} />
          </NavLink>
          <Button variant="ghost" icon={SignOut} aria-label={t.nav.logOut} title={t.nav.logOut} onClick={logout} />
        </div>
      </header>
      <main className="main staff-app__main" id={MAIN_ID} tabIndex={-1}>
        <div className="main__frame">
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<Loading />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
      <div className="staff-app__bottom-tabs">{tabs}</div>
    </div>
  );
}
