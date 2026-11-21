import type { UserRole } from '../services/types';

/** What each role may do; the API's list (backend/src/utils/roles.ts), changed by a main admin in Settings → Roles. */
export const POWERS = ['sell', 'oversee', 'products', 'manage', 'books', 'filing', 'reopen', 'entries', 'customers', 'documents', 'payroll', 'import'] as const;
export type Power = (typeof POWERS)[number];
export type Grants = Record<Power, UserRole[]>;

export interface Permissions {
  powers: Grants;
  /** Menu address → the roles that see it, for pages changed from the usual. */
  pages: Record<string, UserRole[]>;
  defaults: Grants;
  editableRoles: UserRole[];
  lockedPowers: Power[];
}

/** Always every power, whatever the grid says (as the API's EVERYTHING). */
const EVERYTHING: UserRole[] = ['developer', 'main_admin', 'owner'];
const OVERSEERS: UserRole[] = [...EVERYTHING, 'admin'];
const SELLERS: UserRole[] = [...OVERSEERS, 'employee'];
/** The usual rules, used until the API's answer arrives (and if it can't be reached). */
const DEFAULT_GRANTS: Grants = {
  sell: SELLERS,
  oversee: OVERSEERS,
  products: OVERSEERS,
  manage: [...EVERYTHING, 'admin'],
  books: [...OVERSEERS, 'accountant'],
  filing: [...OVERSEERS, 'accountant'],
  reopen: [...EVERYTHING, 'accountant'],
  entries: [...EVERYTHING, 'admin', 'accountant'],
  customers: [...SELLERS, 'accountant'],
  documents: [...SELLERS, 'accountant'],
  payroll: [...EVERYTHING, 'accountant'],
  import: EVERYTHING,
};

export const DEFAULT_PERMISSIONS: Permissions = {
  powers: DEFAULT_GRANTS,
  pages: {},
  defaults: DEFAULT_GRANTS,
  editableRoles: ['admin', 'employee', 'accountant', 'family'],
  lockedPowers: ['manage'],
};

let current: Permissions = DEFAULT_PERMISSIONS;

/** Set once signed in (AuthContext) and after a main admin saves Settings → Roles. */
export function setPermissions(permissions: Permissions): void {
  current = permissions;
}

/** What each role may do, as last set. */
export const currentPermissions = (): Permissions => current;

/** A power the server doesn't list yet (an older API during a deploy) follows its default. */
export const hasPower = (role: UserRole, power: Power): boolean => EVERYTHING.includes(role) || (current.powers[power] ?? DEFAULT_GRANTS[power]).includes(role);

/** The roles chosen for a menu page, or undefined when it follows the usual rules. */
export const pageRoles = (path: string): UserRole[] | undefined => current.pages[path];
