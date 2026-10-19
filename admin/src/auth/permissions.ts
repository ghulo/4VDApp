import type { UserRole } from '../services/types';

/** What each role may do; the API's list (backend/src/utils/roles.ts), changed by the developer in Settings → Roles. */
export const POWERS = ['sell', 'oversee', 'products', 'manage', 'books', 'filing', 'reopen', 'entries', 'customers', 'documents'] as const;
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

const OVERSEERS: UserRole[] = ['developer', 'admin', 'owner'];
const SELLERS: UserRole[] = [...OVERSEERS, 'employee'];
/** The usual rules, used until the API's answer arrives (and if it can't be reached). */
const DEFAULT_GRANTS: Grants = {
  sell: SELLERS,
  oversee: OVERSEERS,
  products: OVERSEERS,
  manage: ['developer', 'admin'],
  books: [...OVERSEERS, 'accountant'],
  filing: [...OVERSEERS, 'accountant'],
  reopen: ['developer', 'owner', 'accountant'],
  entries: ['developer', 'admin', 'accountant'],
  customers: [...SELLERS, 'accountant'],
  documents: [...SELLERS, 'accountant'],
};

export const DEFAULT_PERMISSIONS: Permissions = {
  powers: DEFAULT_GRANTS,
  pages: {},
  defaults: DEFAULT_GRANTS,
  editableRoles: ['admin', 'owner', 'employee', 'accountant', 'family'],
  lockedPowers: ['manage'],
};

let current: Permissions = DEFAULT_PERMISSIONS;

/** Set once signed in (AuthContext) and after the developer saves Settings → Roles. */
export function setPermissions(permissions: Permissions): void {
  current = permissions;
}

export const hasPower = (role: UserRole, power: Power): boolean => current.powers[power].includes(role);

/** The roles chosen for a menu page, or undefined when it follows the usual rules. */
export const pageRoles = (path: string): UserRole[] | undefined => current.pages[path];
