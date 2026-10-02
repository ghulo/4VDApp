import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, Outlet } from 'react-router';
import { useAuth, useCurrentUser } from '../auth/useAuth';
import { approvalsApi, notificationsApi } from '../services/api';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { LogoMark } from './LogoMark';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  /** Which waiting count to show next to it, if any. */
  badge?: 'approvals' | 'alerts';
}

/** Grouped the way the owner works: what needs doing now, the shelves, then the business. */
const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Today',
    items: [
      { to: '/', label: 'Overview', end: true },
      { to: '/approvals', label: 'Approvals', badge: 'approvals' },
      { to: '/alerts', label: 'Alerts', badge: 'alerts' },
      { to: '/ask', label: 'Ask' },
    ],
  },
  {
    label: 'Shelves',
    items: [
      { to: '/inventory', label: 'Stock' },
      { to: '/counts', label: 'Counts' },
      { to: '/products', label: 'Products' },
      { to: '/promotions', label: 'Promotions' },
      { to: '/categories', label: 'Categories' },
    ],
  },
  {
    label: 'Business',
    items: [
      { to: '/sales', label: 'Sales' },
      { to: '/reports', label: 'Reports' },
      { to: '/people', label: 'People' },
      { to: '/activity', label: 'Activity' },
      { to: '/settings', label: 'Settings' },
    ],
  },
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
  const approvals = useQuery({
    queryKey: ['approvals', 'summary'],
    queryFn: approvalsApi.summary,
    refetchInterval: ALERT_POLL_MS,
  });
  const waitingCount = approvals.data?.total ?? 0;

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="sidebar__brand" aria-label="4VD, go to Overview">
          <LogoMark size={34} />
          4VD
        </Link>
        <nav className="sidebar__nav" aria-label="Main">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="sidebar__group">
              <p className="sidebar__group-label">{group.label}</p>
              {group.items.map((item) => {
                const count = item.badge === 'approvals' ? waitingCount : item.badge === 'alerts' ? unreadCount : 0;
                return (
                  <NavLink key={item.to} to={item.to} end={item.end} className="sidebar__link">
                    {item.label}
                    {count > 0 && (
                      <span
                        className="sidebar__badge"
                        aria-label={item.badge === 'approvals' ? `${count} waiting for you` : `${count} unread`}
                      >
                        {count}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar__account">
          <ThemeSwitch />
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
