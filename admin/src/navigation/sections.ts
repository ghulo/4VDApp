import {
  Bank,
  Books,
  CashRegister,
  ChartLine,
  ClipboardText,
  ClockCounterClockwise,
  Coins,
  Gear,
  HandCoins,
  House,
  AddressBook,
  Storefront,
  Package,
  Percent,
  Receipt,
  Sparkle,
  Tray,
  Users,
  Wallet,
  type Icon,
} from '@phosphor-icons/react';
import { hasPower, pageRoles, type Power } from '../auth/permissions';
import { canManage, canOversee } from '../auth/roles';
import type { Catalogue } from '../i18n/en';
import type { ShopFeatures, UserRole } from '../services/types';

type NavKey = keyof Catalogue['nav']['items'];
type TabKey = keyof Catalogue['nav']['tabs'];

/** The search a tab link carries: the current one, only the named keys of it, or none. */
export function tabSearch(tab: Pick<SectionTab, 'keepSearch'>, search: string): string {
  if (!tab.keepSearch) return '';
  if (tab.keepSearch === true) return search;
  const current = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const key of tab.keepSearch) {
    const value = current.get(key);
    if (value !== null) kept.set(key, value);
  }
  const text = kept.toString();
  return text ? `?${text}` : '';
}

/** A page that lives under a menu item as one of its tabs. */
export interface SectionTab {
  to: string;
  key: TabKey;
  /**
   * Keep the address's filters (like the chosen period) when switching to this tab:
   * all of them, or only the named ones (the VAT tabs share just `month`).
   */
  keepSearch?: boolean | readonly string[];
  /** The accountant sees it (they see only the money side). */
  accountant?: boolean;
  /** Opened now and then (setup, year end): it waits under the row's More, unless it is the page you are on. */
  rare?: boolean;
  /** Only for those who oversee the business (managers and the owner). */
  overseersOnly?: boolean;
  /** Only once the shop keeps stock in more than one location. */
  locations?: boolean;
  /** Only once this feature is switched on (Settings → Features). */
  feature?: keyof ShopFeatures;
  /** Only for roles with this power (Settings → Roles), like pay for the owner and the accountant. */
  power?: Power;
}

export interface NavItem {
  to: string;
  key: NavKey;
  icon: Icon;
  /** Other pages that belong to this item, so it stays highlighted on them. */
  also?: string[];
  /** Which waiting count to show next to it, if any. */
  badge?: 'inbox';
  /** Only for those who change the business's setup (managers and the owner). */
  managersOnly?: boolean;
  /** Only for those who oversee the business (managers and the owner), like the books. */
  overseersOnly?: boolean;
  /** The accountant sees it (they see only the money side). */
  accountant?: boolean;
  /** Only for roles with this power (Settings → Roles). */
  power?: Power;
}

/**
 * Pages that share one menu item and switch with tabs at the top. Each keeps
 * its own address, so old links and bookmarks still open the right tab.
 */
export const SECTIONS = {
  inbox: [
    { to: '/inbox', key: 'todo', accountant: true },
    { to: '/inbox/updates', key: 'updates', accountant: true },
  ],
  stock: [
    { to: '/inventory', key: 'shelf' },
    { to: '/products', key: 'products' },
    { to: '/prices', key: 'prices', overseersOnly: true },
    { to: '/stock-documents', key: 'stockDocuments', overseersOnly: true, accountant: true },
    { to: '/stock-moves', key: 'stockMoves', overseersOnly: true, locations: true },
    { to: '/makes', key: 'makes', overseersOnly: true, feature: 'recipes' },
    { to: '/serials', key: 'serials', feature: 'serials' },
    { to: '/expiring', key: 'expiring' },
    { to: '/categories', key: 'categories' },
  ],
  sales: [
    { to: '/sales', key: 'history', accountant: true },
    { to: '/documents', key: 'invoices', accountant: true },
    { to: '/offers', key: 'offers', accountant: true },
    { to: '/to-deliver', key: 'toDeliver' },
    { to: '/portal-orders', key: 'online', overseersOnly: true },
  ],
  day: [
    { to: '/day', key: 'close' },
    { to: '/cash', key: 'cash' },
    { to: '/carwash', key: 'carwash' },
  ],
  buy: [
    { to: '/suppliers', key: 'suppliers', accountant: true },
    { to: '/orders', key: 'orders', accountant: true },
    { to: '/bills', key: 'bills', accountant: true },
  ],
  books: [
    { to: '/books', key: 'balances', keepSearch: true, accountant: true },
    { to: '/books/journal', key: 'journal', keepSearch: true, accountant: true },
    { to: '/books/accounts', key: 'accounts', accountant: true, rare: true },
    { to: '/books/opening', key: 'opening', accountant: true, rare: true },
    { to: '/books/vat', key: 'vat', keepSearch: ['month'], accountant: true },
    { to: '/books/sales-book', key: 'salesBook', keepSearch: ['month'], accountant: true },
    { to: '/books/purchase-book', key: 'purchaseBook', keepSearch: ['month'], accountant: true },
    { to: '/books/statements', key: 'statements', accountant: true },
    { to: '/books/assets', key: 'assets', accountant: true },
    { to: '/books/year', key: 'year', accountant: true, rare: true },
    { to: '/books/declaration', key: 'declaration', accountant: true, rare: true },
    { to: '/books/trefin', key: 'trefin', keepSearch: ['month'], accountant: true, rare: true },
  ],
  payroll: [
    { to: '/payroll', key: 'payrollPeople', power: 'payroll', accountant: true },
    { to: '/payroll/months', key: 'payrollMonths', power: 'payroll', accountant: true },
  ],
  reports: [
    { to: '/report', key: 'report', accountant: true },
    { to: '/reports', key: 'analytics', keepSearch: true },
    { to: '/reports/team', key: 'team', keepSearch: true },
    { to: '/reports/counter', key: 'counter', keepSearch: true },
    { to: '/reports/profit', key: 'profit', keepSearch: true, accountant: true },
    { to: '/reports/projects', key: 'projects', keepSearch: true, accountant: true, feature: 'projects' },
    { to: '/reports/downloads', key: 'downloads', keepSearch: true, accountant: true, rare: true },
  ],
} satisfies Record<string, SectionTab[]>;

/** Grouped by the job at hand: today, selling, the shelves, buying, the money, the team. */
export const NAV_GROUPS: Array<{ key: keyof Catalogue['nav']['groups']; items: NavItem[] }> = [
  {
    key: 'today',
    items: [
      { to: '/', key: 'overview', icon: House },
      { to: '/inbox', key: 'inbox', icon: Tray, badge: 'inbox', accountant: true },
      { to: '/ask', key: 'ask', icon: Sparkle },
    ],
  },
  {
    key: 'sell',
    items: [
      { to: '/counter', key: 'counter', icon: CashRegister },
      { to: '/sales', key: 'sales', icon: Receipt, also: ['/documents', '/offers', '/to-deliver', '/portal-orders'], accountant: true },
      { to: '/customers', key: 'customers', icon: AddressBook, accountant: true },
      { to: '/promotions', key: 'promotions', icon: Percent },
    ],
  },
  {
    key: 'stock',
    items: [
      { to: '/inventory', key: 'stock', icon: Package, also: ['/products', '/prices', '/stock-documents', '/stock-moves', '/makes', '/serials', '/expiring', '/categories', '/labels'] },
      { to: '/counts', key: 'counts', icon: ClipboardText },
    ],
  },
  {
    key: 'buy',
    items: [
      { to: '/suppliers', key: 'suppliers', icon: Storefront, also: ['/orders', '/bills'], accountant: true },
    ],
  },
  {
    key: 'money',
    items: [
      { to: '/day', key: 'day', icon: Coins, also: ['/cash', '/carwash'] },
      { to: '/expenses', key: 'expenses', icon: Wallet, accountant: true },
      { to: '/report', key: 'reports', icon: ChartLine, also: ['/reports'], accountant: true },
      { to: '/money', key: 'money', icon: Bank, overseersOnly: true, accountant: true },
      { to: '/books', key: 'books', icon: Books, overseersOnly: true, accountant: true },
    ],
  },
  {
    key: 'team',
    items: [
      { to: '/people', key: 'people', icon: Users },
      { to: '/payroll', key: 'payroll', icon: HandCoins, power: 'payroll', accountant: true },
      { to: '/activity', key: 'activity', icon: ClockCounterClockwise },
      { to: '/settings', key: 'settings', icon: Gear, managersOnly: true },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((group) => group.items);
const itemsAt = (paths: string[]) => paths.flatMap((path) => ALL_ITEMS.filter((item) => item.to === path));

/** The bar along the bottom on a phone: the first four of these the person may open; Menu opens the rest. */
export function phoneTabsFor(role: UserRole): NavItem[] {
  return itemsAt(['/', '/inbox', '/sales', '/inventory', '/books'])
    .filter((item) => shownTo(role, item))
    .slice(0, 4);
}

/** The roles that see every page, whatever Settings → Roles says: the owner runs the whole business. */
const SEES_EVERYTHING: UserRole[] = ['developer', 'main_admin', 'owner'];

/** Whether this person sees the menu item or tab: as chosen in Settings → Roles, else the accountant sees only the money side. */
export function shownTo(role: UserRole, item: { to: string; managersOnly?: boolean; overseersOnly?: boolean; accountant?: boolean; power?: Power }): boolean {
  return SEES_EVERYTHING.includes(role) || (pageRoles(item.to)?.includes(role) ?? usuallyShownTo(role, item));
}

/** The usual rule, before any change in Settings → Roles. */
export function usuallyShownTo(role: UserRole, item: { managersOnly?: boolean; overseersOnly?: boolean; accountant?: boolean; power?: Power }): boolean {
  if (item.power) return hasPower(role, item.power);
  if (role === 'accountant') return Boolean(item.accountant);
  return (!item.managersOnly || canManage(role)) && (!item.overseersOnly || canOversee(role));
}

/** Whether the menu item is the one for this address (its own page, a tab under it, or a detail page). */
export function isCurrent(item: NavItem, pathname: string): boolean {
  if (item.to === '/') return pathname === '/';
  return [item.to, ...(item.also ?? [])].some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
