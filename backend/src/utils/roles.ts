import { currentBusinessId, currentContext } from '../database/businessContext.js';
import type { StoredRole, UserRole } from '../database/types.js';

/**
 * Who may do what, in one place.
 *
 * Each power below is held by a list of roles. The lists start as the shop's
 * usual rules (DEFAULT_GRANTS) and each business's main admin can change them
 * for that business in Settings → Roles; PermissionService loads the saved
 * lists into this module, so every check here and every route guard follows
 * the current business's lists at once.
 *
 * - developer: 4VD's own staff (users.is_platform_developer), in any business:
 *   everything, always. Never stored as a role inside a business.
 * - main_admin: the top role inside one business: everything, hands out the top roles.
 * - admin: runs the shop day to day (products, stock, people below them, settings).
 * - owner: sees the whole business, decides requests, and adds and edits products.
 * - employee: sells and sends requests from the counter.
 * - family: browses.
 * - accountant: reads the money side (books, VAT, bills, invoices, expenses,
 *   reports, customers and suppliers), files and reopens VAT months and asks
 *   questions on documents; never sells or changes stock, prices or people.
 */
export const POWERS = ['sell', 'oversee', 'products', 'manage', 'books', 'filing', 'reopen', 'entries', 'customers', 'documents', 'payroll'] as const;
export type Power = (typeof POWERS)[number];
export type Grants = Record<Power, UserRole[]>;

/** The roles a main admin can give or take powers from (developer and main admin always have them all). */
export const EDITABLE_ROLES: UserRole[] = ['admin', 'owner', 'employee', 'accountant', 'family'];

/**
 * Powers that can't be changed: someone must always be able to manage people
 * and settings, or the shop could lock itself out.
 */
export const LOCKED_POWERS: Power[] = ['manage'];

const OVERSEERS: UserRole[] = ['developer', 'main_admin', 'admin', 'owner'];
const SELLERS: UserRole[] = [...OVERSEERS, 'employee'];

export const DEFAULT_GRANTS: Grants = {
  /** Record sales and send requests. */
  sell: SELLERS,
  /** See the whole business (reports, cost prices, activity) and approve or reject requests. */
  oversee: OVERSEERS,
  /** Add products and change their details, price, barcode and photo (deleting stays with managers). */
  products: OVERSEERS,
  /** Change products, stock, people and settings. */
  manage: ['developer', 'main_admin', 'admin'],
  /** Read the books, VAT, bills, invoices, expenses, reports and the customer and supplier lists. */
  books: [...OVERSEERS, 'accountant'],
  /** Mark a VAT month as filed. */
  filing: [...OVERSEERS, 'accountant'],
  /** Reopen a filed VAT month. */
  reopen: ['developer', 'main_admin', 'owner', 'accountant'],
  /** Write and reverse hand-written entries in the books. */
  entries: ['developer', 'main_admin', 'admin', 'accountant'],
  /** Read the customer list and a customer's page: the counter (for tabs) and the accountant. */
  customers: [...SELLERS, 'accountant'],
  /** Open and print an invoice: the counter (its own, checked in the service) and the accountant. */
  documents: [...SELLERS, 'accountant'],
  payroll: ['developer', 'main_admin', 'owner', 'accountant'],
};

/**
 * Each business's grid, as saved in its own settings (missing = the usual
 * rules). PermissionService fills this in for every business before the first
 * check, and replaces one business's entry when its main admin saves.
 */
const grids = new Map<number, Grants>();

/**
 * The grid for the saved changes: the defaults with the changes on top. Only
 * editable roles move; the developer and main admin keep everything and locked
 * powers keep their default.
 */
export function gridFrom(changes: Partial<Grants>): Grants {
  const next = { ...DEFAULT_GRANTS };
  for (const power of POWERS) {
    const chosen = changes[power];
    if (!chosen || LOCKED_POWERS.includes(power)) continue;
    const kept = DEFAULT_GRANTS[power].filter((role) => !EDITABLE_ROLES.includes(role));
    next[power] = [...kept, ...EDITABLE_ROLES.filter((role) => chosen.includes(role))];
  }
  return next;
}

/** Use `changes` as `businessId`'s grid from the next check on. */
export function setGrants(businessId: number, changes: Partial<Grants>): Grants {
  const grid = gridFrom(changes);
  grids.set(businessId, grid);
  return grid;
}

/** Drop every business's grid (tests reset the data underneath). */
export function forgetGrants(): void {
  grids.clear();
}

/**
 * The grid of the business the current work is for: the one requireAuth
 * entered, or for a public page the one the visitor's token names. With no
 * business at all (signing in), the usual rules.
 */
export function currentGrants(): Grants {
  const businessId = currentBusinessId() ?? currentContext()?.powersOf ?? null;
  return (businessId !== null && grids.get(businessId)) || DEFAULT_GRANTS;
}

/** Everyone who holds `power` right now, in the current business. */
export const rolesWith = (power: Power): UserRole[] => currentGrants()[power];
export const hasPower = (role: UserRole | undefined, power: Power): boolean => role !== undefined && currentGrants()[power].includes(role);

/** Roles only a main admin (or the 4VD developer) may give, change or take away. The accountant sees every figure, so it is one. */
export const TOP_ROLES: UserRole[] = ['main_admin', 'admin', 'owner', 'accountant'];

/** The roles that hold every power in a business and may change its powers grid. */
export const isTopRole = (role: UserRole | undefined): boolean => role === 'developer' || role === 'main_admin';

/** The roles that can be stored on a person (users.role): developer is a flag, not a role. */
export const storedOnly = (roles: readonly UserRole[]): StoredRole[] => roles.filter((role): role is StoredRole => role !== 'developer');

export const canManage = (role: UserRole | undefined): boolean => hasPower(role, 'manage');
export const canOversee = (role: UserRole | undefined): boolean => hasPower(role, 'oversee');
export const canSell = (role: UserRole | undefined): boolean => hasPower(role, 'sell');
export const canReadBooks = (role: UserRole | undefined): boolean => hasPower(role, 'books');
export const canReopen = (role: UserRole | undefined): boolean => hasPower(role, 'reopen');
export const canEditProducts = (role: UserRole | undefined): boolean => hasPower(role, 'products');

/** A person as stored, for the checks below. */
type Person = { id: number; role: UserRole; is_platform_developer: boolean };

/**
 * May `actor` change `target` (details, password, block, delete, reset their
 * sign-in)? 4VD's developer only changes himself: no business can take over
 * the account that opens every business.
 */
export function mayChangePerson(actor: Person, target: Person): boolean {
  if (target.is_platform_developer) return actor.id === target.id;
  return canHandOut(actor.is_platform_developer ? 'developer' : actor.role, target.role);
}

/** May someone with `actorRole` give a person `targetRole`, or change a person who has it? */
export function canHandOut(actorRole: UserRole, targetRole: UserRole): boolean {
  if (targetRole === 'developer') return false; // 4VD staff only, set by hand on the database
  return isTopRole(actorRole) || !TOP_ROLES.includes(targetRole);
}
