import { USER_ROLES, type UserRole } from '../services/types';
import { hasPower } from './permissions';

// The same rules as the API (backend/src/utils/roles.ts), as the developer set
// them in Settings → Roles; the API enforces them, these only decide what to show.

/** Change products, stock, people and settings. */
export const canManage = (role: UserRole): boolean => hasPower(role, 'manage');
/** See the whole business and decide requests. */
export const canOversee = (role: UserRole): boolean => hasPower(role, 'oversee');
/** Add products and change their details, price, barcode and photo; deleting stays with managers. */
export const canEditProducts = (role: UserRole): boolean => hasPower(role, 'products');
/** The money side: the books, VAT, bills, invoices, expenses and reports. The accountant too. */
export const canReadBooks = (role: UserRole): boolean => hasPower(role, 'books');
/** The people who sell but don't run the shop: they get the simple staff 4VD (Home, Products, Sell, Account). */
export const counterOnly = (role: UserRole): boolean => role === 'employee';
/** Uses the staff layout: bottom tabs and only the counter's own pages. */
export const staffLayout = counterOnly;
/** Sell at the Counter: everyone who sells in the team app too. */
export const canSell = (role: UserRole): boolean => hasPower(role, 'sell');
/** Use the dashboard at all: whoever oversees the business, the accountant, and employees for the Counter. */
export const canUseDashboard = (role: UserRole): boolean => canOversee(role) || canReadBooks(role) || counterOnly(role);
/** Reopen a filed VAT month: the accountant, the owner and the developer. */
export const canReopen = (role: UserRole): boolean => hasPower(role, 'reopen');
/** Write hand-written entries in the books: managers and the accountant. */
export const canWriteEntries = (role: UserRole): boolean => hasPower(role, 'entries');

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
