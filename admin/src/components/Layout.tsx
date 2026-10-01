import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router';
import { useAuth, useCurrentUser } from '../auth/useAuth';
import { notificationsApi } from '../services/api';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', end: true },
  { to: '/inventory', label: 'Stock' },
  { to: '/sales', label: 'Sales' },
  { to: '/reports', label: 'Reports' },
  { to: '/products', label: 'Products' },
  { to: '/categories', label: 'Categories' },
  { to: '/people', label: 'People' },
  { to: '/activity', label: 'Activity' },
];

const ALERT_POLL_MS = 60_000;

export function Layout() {
  const user = useCurrentUser();
  const { logout } = useAuth();
  // Poll so a low-stock alert from an employee's sale shows up without a reload.
  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => (await notificationsApi.list(1, true)).unreadCount,
    refetchInterval: ALERT_POLL_MS,
  });
  const unreadCount = unread.data ?? 0;

  return (
    <div className="shell">
      <aside className="sidebar">
        <p className="sidebar__brand">4VD</p>
        <nav className="sidebar__nav" aria-label="Main">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="sidebar__link">
              {item.label}
            </NavLink>
          ))}
          <NavLink to="/alerts" className="sidebar__link">
            Alerts
            {unreadCount > 0 && (
              <span className="sidebar__badge" aria-label={`${unreadCount} unread`}>
                {unreadCount}
              </span>
            )}
          </NavLink>
        </nav>
        <div className="sidebar__account">
          <span className="sidebar__user">{user.name}</span>
          <button type="button" className="sidebar__logout" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
