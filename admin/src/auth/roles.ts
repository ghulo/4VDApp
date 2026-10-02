import { USER_ROLES, type UserRole } from '../services/types';

// The same rules as the API (backend/src/utils/roles.ts); the API enforces them,
// these only decide what to show.

/** Change products, stock, people and settings. */
export const canManage = (role: UserRole): boolean => role === 'developer' || role === 'admin';
/** Use the dashboard: see the whole business and decide requests. */
export const canOversee = (role: UserRole): boolean => canManage(role) || role === 'owner';

const TOP_ROLES: UserRole[] = ['developer', 'admin', 'owner'];

/** May `actor` give someone `role`, or change someone who has it? */
export function canHandOut(actor: UserRole, role: UserRole): boolean {
  if (!canManage(actor)) return false;
  return actor === 'developer' || !TOP_ROLES.includes(role);
}

/** The roles `actor` may choose from when adding or changing someone. */
export function assignableRoles(actor: UserRole): UserRole[] {
  return USER_ROLES.filter((role) => canHandOut(actor, role));
}
