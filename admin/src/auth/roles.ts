import { USER_ROLES, type UserRole } from '../services/types';
import { hasPower } from './permissions';

// The same rules as the API (backend/src/utils/roles.ts), as a main admin set
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
/** Family: browse the products and keep favourites, nothing else (the old team app's family view). */
export const browseOnly = (role: UserRole): boolean => role === 'family';
/** Uses the staff layout: bottom tabs and only the counter's own pages (family: only Products and Account). */
export const staffLayout = (role: UserRole): boolean => counterOnly(role) || browseOnly(role);
/** Sell at the Counter: everyone who sells in the team app too. */
export const canSell = (role: UserRole): boolean => hasPower(role, 'sell');
/** Use the dashboard at all: whoever oversees the business, the accountant, employees for the Counter and family to browse. */
export const canUseDashboard = (role: UserRole): boolean => canOversee(role) || canReadBooks(role) || staffLayout(role);
/** Reopen a filed VAT month: the accountant, the owner and the main admin. */
export const canReopen = (role: UserRole): boolean => hasPower(role, 'reopen');
/** Write hand-written entries in the books: managers, the owner and the accountant. */
export const canWriteEntries = (role: UserRole): boolean => hasPower(role, 'entries');

const TOP_ROLES: UserRole[] = ['main_admin', 'admin', 'owner', 'accountant'];

/** Every power in the business, and changes its powers grid: the main admin, and 4VD's developer. */
export const isTopRole = (role: UserRole): boolean => role === 'developer' || role === 'main_admin';

/** May `actor` give someone `role`, or change someone who has it? developer is never handed out. */
export function canHandOut(actor: UserRole, role: UserRole): boolean {
  if (!canManage(actor) || role === 'developer') return false;
  return isTopRole(actor) || !TOP_ROLES.includes(role);
}

/** The roles `actor` may choose from when adding or changing someone. */
export function assignableRoles(actor: UserRole): UserRole[] {
  return USER_ROLES.filter((role) => canHandOut(actor, role));
}
