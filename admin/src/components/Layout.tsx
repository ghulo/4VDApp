import { NavLink, Outlet } from 'react-router';
import { useAuth, useCurrentUser } from '../auth/useAuth';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', end: true },
  { to: '/inventory', label: 'Stock' },
  { to: '/products', label: 'Products' },
  { to: '/categories', label: 'Categories' },
];

export function Layout() {
  const user = useCurrentUser();
  const { logout } = useAuth();

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
