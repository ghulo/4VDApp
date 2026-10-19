import type { UserRole } from '../database/types.js';

/**
 * Who may do what, in one place.
 *
 * Each power below is held by a list of roles. The lists start as the shop's
 * usual rules (DEFAULT_GRANTS) and the developer can change them in
 * Settings → Roles; PermissionService loads the saved lists into this module,
 * so every check here and every route guard follows them at once.
 *
 * - developer: everything, always; the only one who hands out the top roles.
 * - admin: runs the shop day to day (products, stock, people below them, settings).
 * - owner: sees the whole business, decides requests, and adds and edits products.
 * - employee: sells and sends requests from the counter.
 * - family: browses.
 * - accountant: reads the money side (books, VAT, bills, invoices, expenses,
 *   reports, customers and suppliers), files and reopens VAT months and asks
 *   questions on documents; never sells or changes stock, prices or people.
 */
export const POWERS = ['sell', 'oversee', 'products', 'manage', 'books', 'filing', 'reopen', 'entries', 'customers', 'documents'] as const;
export type Power = (typeof POWERS)[number];
export type Grants = Record<Power, UserRole[]>;

/** The roles the developer can give or take powers from (the developer always has them all). */
export const EDITABLE_ROLES: UserRole[] = ['admin', 'owner', 'employee', 'accountant', 'family'];

/**
 * Powers that can't be changed: someone must always be able to manage people
 * and settings, or the shop could lock itself out.
 */
export const LOCKED_POWERS: Power[] = ['manage'];

const OVERSEERS: UserRole[] = ['developer', 'admin', 'owner'];
const SELLERS: UserRole[] = [...OVERSEERS, 'employee'];

export const DEFAULT_GRANTS: Grants = {
  /** Record sales and send requests. */
  sell: SELLERS,
  /** See the whole business (reports, cost prices, activity) and approve or reject requests. */
  oversee: OVERSEERS,
  /** Add products and change their details, price, barcode and photo (deleting stays with managers). */
  products: OVERSEERS,
  /** Change products, stock, people and settings. */
  manage: ['developer', 'admin'],
  /** Read the books, VAT, bills, invoices, expenses, reports and the customer and supplier lists. */
  books: [...OVERSEERS, 'accountant'],
  /** Mark a VAT month as filed. */
  filing: [...OVERSEERS, 'accountant'],
  /** Reopen a filed VAT month. */
  reopen: ['developer', 'owner', 'accountant'],
  /** Write and reverse hand-written entries in the books. */
  entries: ['developer', 'admin', 'accountant'],
  /** Read the customer list and a customer's page: the counter (for tabs) and the accountant. */
  customers: [...SELLERS, 'accountant'],
  /** Open and print an invoice: the counter (its own, checked in the service) and the accountant. */
  documents: [...SELLERS, 'accountant'],
};

let grants: Grants = { ...DEFAULT_GRANTS };

/**
 * Put the saved changes on top of the defaults. Only editable roles move;
 * the developer keeps everything and locked powers keep their default.
 */
export function applyGrants(changes: Partial<Grants>): Grants {
  const next = { ...DEFAULT_GRANTS };
  for (const power of POWERS) {
    const chosen = changes[power];
    if (!chosen || LOCKED_POWERS.includes(power)) continue;
    const kept = DEFAULT_GRANTS[power].filter((role) => !EDITABLE_ROLES.includes(role));
    next[power] = [...kept, ...EDITABLE_ROLES.filter((role) => chosen.includes(role))];
  }
  grants = next;
  return next;
}

export const currentGrants = (): Grants => grants;

/** Everyone who holds `power` right now. */
export const rolesWith = (power: Power): UserRole[] => grants[power];
export const hasPower = (role: UserRole | undefined, power: Power): boolean => role !== undefined && grants[power].includes(role);

/** Roles only a developer may give, change or take away. The accountant sees every figure, so it is one. */
export const TOP_ROLES: UserRole[] = ['developer', 'admin', 'owner', 'accountant'];

export const canManage = (role: UserRole | undefined): boolean => hasPower(role, 'manage');
export const canOversee = (role: UserRole | undefined): boolean => hasPower(role, 'oversee');
export const canSell = (role: UserRole | undefined): boolean => hasPower(role, 'sell');
export const canReadBooks = (role: UserRole | undefined): boolean => hasPower(role, 'books');
export const canReopen = (role: UserRole | undefined): boolean => hasPower(role, 'reopen');
export const canEditProducts = (role: UserRole | undefined): boolean => hasPower(role, 'products');

/** May someone with `actorRole` give a person `targetRole`, or change a person who has it? */
export function canHandOut(actorRole: UserRole, targetRole: UserRole): boolean {
  return actorRole === 'developer' || !TOP_ROLES.includes(targetRole);
}
