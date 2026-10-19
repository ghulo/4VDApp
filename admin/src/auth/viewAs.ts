import type { UserRole } from '../services/types';

/**
 * Settings → Roles → View as: the developer sees 4VD as another role would.
 * Kept per tab, so a reload stays in the preview and a new tab starts as yourself.
 * The API answers as that role and saves nothing (backend authenticate.ts).
 */
const KEY = '4vd.viewAs';

/** The roles that have a dashboard to look at; family has none. */
export const VIEWABLE_ROLES: UserRole[] = ['admin', 'owner', 'accountant', 'employee'];

export function readViewAs(): UserRole | null {
  try {
    const saved = sessionStorage.getItem(KEY) as UserRole | null;
    return saved && VIEWABLE_ROLES.includes(saved) ? saved : null;
  } catch {
    return null;
  }
}

function writeViewAs(role: UserRole | null): void {
  try {
    if (role) sessionStorage.setItem(KEY, role);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Private windows may refuse storage; the preview then simply doesn't start.
  }
}

/** Start or switch the preview: the whole app opens again from Home, as that role. */
export function startViewingAs(role: UserRole): void {
  writeViewAs(role);
  window.location.assign('/');
}

/** Back to yourself, on the Roles page you came from. */
export function stopViewing(): void {
  writeViewAs(null);
  window.location.assign('/settings/roles');
}

/** Signing out ends any preview without moving the page. */
export function forgetViewAs(): void {
  writeViewAs(null);
}
