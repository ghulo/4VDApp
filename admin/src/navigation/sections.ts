import {
  Bank,
  Books,
  CashRegister,
  ChartLine,
  ClipboardText,
  ClockCounterClockwise,
  Coins,
  Gear,
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
import { canManage, canOversee } from '../auth/roles';
import type { Catalogue } from '../i18n/en';
import type { UserRole } from '../services/types';

type NavKey = keyof Catalogue['nav']['items'];
type TabKey = keyof Catalogue['nav']['tabs'];

/** A page that lives under a menu item as one of its tabs. */
export interface SectionTab {
  to: string;
  key: TabKey;
  /** Keep the address's filters (like the chosen period) when switching to this tab. */
  keepSearch?: boolean;
  /** The accountant sees it (they see only the money side). */
  accountant?: boolean;
}

export interface NavItem {
  to: string;
  key: NavKey;
  icon: Icon;
  /** Other pages that belong to this item, so it stays highlighted on them. */
  also?: string[];
  /** Which waiting count to show next to it, if any. */
  badge?: 'inbox';
  /** Hidden from the owner, who sees the business but doesn't change its setup. */
  managersOnly?: boolean;
  /** Only for those who oversee the business (managers and the owner), like the books. */
  overseersOnly?: boolean;
  /** The accountant sees it (they see only the money side). */
  accountant?: boolean;
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
    { to: '/categories', key: 'categories' },
  ],
  sales: [
    { to: '/sales', key: 'history', accountant: true },
    { to: '/documents', key: 'invoices', accountant: true },
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
    { to: '/books/accounts', key: 'accounts', accountant: true },
    { to: '/books/opening', key: 'opening', accountant: true },
    { to: '/books/vat', key: 'vat', accountant: true },
    { to: '/books/sales-book', key: 'salesBook', accountant: true },
    { to: '/books/purchase-book', key: 'purchaseBook', accountant: true },
  ],
  reports: [
    { to: '/report', key: 'report', accountant: true },
    { to: '/reports', key: 'analytics', keepSearch: true },
    { to: '/reports/team', key: 'team', keepSearch: true },
    { to: '/reports/counter', key: 'counter', keepSearch: true },
    { to: '/reports/profit', key: 'profit', keepSearch: true, accountant: true },
    { to: '/reports/downloads', key: 'downloads', keepSearch: true, accountant: true },
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
      { to: '/sales', key: 'sales', icon: Receipt, also: ['/documents'], accountant: true },
      { to: '/customers', key: 'customers', icon: AddressBook, accountant: true },
      { to: '/promotions', key: 'promotions', icon: Percent },
    ],
  },
  {
    key: 'stock',
    items: [
      { to: '/inventory', key: 'stock', icon: Package, also: ['/products', '/categories', '/labels'] },
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
      { to: '/activity', key: 'activity', icon: ClockCounterClockwise },
      { to: '/settings', key: 'settings', icon: Gear, managersOnly: true },
    ],
  },
];

/** Whether this person sees the menu item or tab: the accountant sees only the money side. */
export function shownTo(role: UserRole, item: { managersOnly?: boolean; overseersOnly?: boolean; accountant?: boolean }): boolean {
  if (role === 'accountant') return Boolean(item.accountant);
  return (!item.managersOnly || canManage(role)) && (!item.overseersOnly || canOversee(role));
}

/** Whether the menu item is the one for this address (its own page, a tab under it, or a detail page). */
export function isCurrent(item: NavItem, pathname: string): boolean {
  if (item.to === '/') return pathname === '/';
  return [item.to, ...(item.also ?? [])].some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
