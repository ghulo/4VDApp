import { SignOut, UserCircle } from '@phosphor-icons/react';
import { Suspense } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth, useCurrentUser } from '../auth/useAuth';
import { useBusinessPicker } from '../auth/useBusinessPicker';
import { useT } from '../i18n/useT';
import { staffTabFor, staffTabs } from '../navigation/staff';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { Avatar } from './Avatar';
import { ErrorBoundary } from './ErrorBoundary';
import { Loading } from './Feedback';
import { LogoMark } from './LogoMark';
import { MenuButton } from './ui';
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
  const navigate = useNavigate();
  useFocusOnRouteChange();
  const t = useT();
  const businesses = useBusinessPicker();
  const shown = staffTabs(user.role);
  const current = staffTabFor(location.pathname, shown);

  const tabs = (
    <nav className="staff-tabs" aria-label={t.staff.tabBar}>
      {shown.map((tab) => {
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
        <Link to={shown[0].to} className="topbar__brand" aria-label={t.nav.home}>
          <LogoMark size={36} />
        </Link>
        <div className="staff-app__wide-tabs">{tabs}</div>
        <div className="topbar__end">
          <ThemeSwitch persist compact />
          {/* Log out sits behind the avatar, as in the full dashboard: a key of its own beside it was one stray tap from signing out. */}
          <MenuButton
            label={t.nav.yourProfile(user.name)}
            face={<Avatar name={user.name} url={user.avatarUrl} size={28} />}
            faceClassName={location.pathname.startsWith('/profile') ? 'topbar__user active' : 'topbar__user'}
            items={[
              ...businesses,
              { label: t.nav.items.profile, icon: UserCircle, divider: businesses.length > 0, onSelect: () => navigate('/profile') },
              { label: t.nav.logOut, icon: SignOut, onSelect: logout },
            ]}
          />
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
