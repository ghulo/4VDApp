import type { UserRole } from '../database/types.js';

/**
 * Who may do what, in one place.
 *
 * - developer: everything; the only one who hands out the top roles.
 * - admin: runs the shop day to day (products, stock, people below them, settings).
 * - owner: sees the whole business, decides requests, and adds and edits products.
 * - employee: sells and sends requests from the counter.
 * - family: browses.
 */

/** Change products, stock, people and settings. */
export const MANAGER_ROLES: UserRole[] = ['developer', 'admin'];
/** See the whole business (reports, cost prices, activity) and approve or reject requests. */
export const OVERSEER_ROLES: UserRole[] = ['developer', 'admin', 'owner'];
/** Record sales and send requests. */
export const SELLER_ROLES: UserRole[] = ['developer', 'admin', 'owner', 'employee'];
/** Roles only a developer may give, change or take away. */
export const TOP_ROLES: UserRole[] = ['developer', 'admin', 'owner'];

export const canManage = (role: UserRole | undefined): boolean => role !== undefined && MANAGER_ROLES.includes(role);
export const canOversee = (role: UserRole | undefined): boolean => role !== undefined && OVERSEER_ROLES.includes(role);
export const canSell = (role: UserRole | undefined): boolean => role !== undefined && SELLER_ROLES.includes(role);
/** Add products and change their details, price, barcode and photo (deleting stays with managers). */
export const PRODUCT_EDITOR_ROLES: UserRole[] = OVERSEER_ROLES;
export const canEditProducts = (role: UserRole | undefined): boolean => role !== undefined && PRODUCT_EDITOR_ROLES.includes(role);

/** May someone with `actorRole` give a person `targetRole`, or change a person who has it? */
export function canHandOut(actorRole: UserRole, targetRole: UserRole): boolean {
  return actorRole === 'developer' || !TOP_ROLES.includes(targetRole);
}
