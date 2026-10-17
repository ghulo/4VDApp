import { USER_ROLES, type UserRole } from '../services/types';

// The same rules as the API (backend/src/utils/roles.ts); the API enforces them,
// these only decide what to show.

/** Change products, stock, people and settings. */
export const canManage = (role: UserRole): boolean => role === 'developer' || role === 'admin';
/** See the whole business and decide requests. */
export const canOversee = (role: UserRole): boolean => canManage(role) || role === 'owner';
/** Add products and change their details, price, barcode and photo; deleting stays with managers. */
export const canEditProducts = canOversee;
/** The money side: the books, VAT, bills, invoices, expenses and reports. The accountant too. */
export const canReadBooks = (role: UserRole): boolean => canOversee(role) || role === 'accountant';
/** Use the dashboard at all: whoever oversees the business, and the accountant. */
export const canUseDashboard = canReadBooks;
/** Reopen a filed VAT month: the accountant, the owner and the developer. */
export const canReopen = (role: UserRole): boolean => role === 'developer' || role === 'owner' || role === 'accountant';
/** Write hand-written entries in the books: managers and the accountant. */
export const canWriteEntries = (role: UserRole): boolean => canManage(role) || role === 'accountant';

const TOP_ROLES: UserRole[] = ['developer', 'admin', 'owner', 'accountant'];

/** May `actor` give someone `role`, or change someone who has it? */
export function canHandOut(actor: UserRole, role: UserRole): boolean {
  if (!canManage(actor)) return false;
  return actor === 'developer' || !TOP_ROLES.includes(role);
}

/** The roles `actor` may choose from when adding or changing someone. */
export function assignableRoles(actor: UserRole): UserRole[] {
  return USER_ROLES.filter((role) => canHandOut(actor, role));
}
