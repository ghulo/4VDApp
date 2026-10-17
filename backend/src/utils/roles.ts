import type { UserRole } from '../database/types.js';

/**
 * Who may do what, in one place.
 *
 * - developer: everything; the only one who hands out the top roles.
 * - admin: runs the shop day to day (products, stock, people below them, settings).
 * - owner: sees the whole business, decides requests, and adds and edits products.
 * - employee: sells and sends requests from the counter.
 * - family: browses.
 * - accountant: reads the money side (books, VAT, bills, invoices, expenses,
 *   reports, customers and suppliers), files and reopens VAT months and asks
 *   questions on documents; never sells or changes stock, prices or people.
 */

/** Change products, stock, people and settings. */
export const MANAGER_ROLES: UserRole[] = ['developer', 'admin'];
/** See the whole business (reports, cost prices, activity) and approve or reject requests. */
export const OVERSEER_ROLES: UserRole[] = ['developer', 'admin', 'owner'];
/** Record sales and send requests. */
export const SELLER_ROLES: UserRole[] = ['developer', 'admin', 'owner', 'employee'];
/** Roles only a developer may give, change or take away. The accountant sees every figure, so it is one. */
export const TOP_ROLES: UserRole[] = ['developer', 'admin', 'owner', 'accountant'];
/** Read the books, VAT, bills, invoices, expenses, reports and the customer and supplier lists. */
export const BOOKKEEPER_ROLES: UserRole[] = [...OVERSEER_ROLES, 'accountant'];
/** Mark a VAT month as filed. */
export const FILING_ROLES: UserRole[] = BOOKKEEPER_ROLES;
/** Reopen a filed VAT month: the accountant, the owner, and the developer who can do anything. */
export const REOPEN_ROLES: UserRole[] = ['developer', 'owner', 'accountant'];
/** Write and reverse hand-written entries in the books. */
export const ENTRY_WRITER_ROLES: UserRole[] = [...MANAGER_ROLES, 'accountant'];
/** Read the customer list and a customer's page: the counter (for tabs) and the accountant. */
export const CUSTOMER_READER_ROLES: UserRole[] = [...SELLER_ROLES, 'accountant'];

export const canManage = (role: UserRole | undefined): boolean => role !== undefined && MANAGER_ROLES.includes(role);
export const canOversee = (role: UserRole | undefined): boolean => role !== undefined && OVERSEER_ROLES.includes(role);
export const canSell = (role: UserRole | undefined): boolean => role !== undefined && SELLER_ROLES.includes(role);
export const canReadBooks = (role: UserRole | undefined): boolean => role !== undefined && BOOKKEEPER_ROLES.includes(role);
export const canReopen = (role: UserRole | undefined): boolean => role !== undefined && REOPEN_ROLES.includes(role);
/** Add products and change their details, price, barcode and photo (deleting stays with managers). */
export const PRODUCT_EDITOR_ROLES: UserRole[] = OVERSEER_ROLES;
export const canEditProducts = (role: UserRole | undefined): boolean => role !== undefined && PRODUCT_EDITOR_ROLES.includes(role);

/** May someone with `actorRole` give a person `targetRole`, or change a person who has it? */
export function canHandOut(actorRole: UserRole, targetRole: UserRole): boolean {
  return actorRole === 'developer' || !TOP_ROLES.includes(targetRole);
}
