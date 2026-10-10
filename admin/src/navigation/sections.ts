import {
  ChartLine,
  ClipboardText,
  ClockCounterClockwise,
  Coins,
  Gear,
  House,
  Invoice,
  AddressBook,
  Storefront,
  Package,
  Percent,
  Receipt,
  Sparkle,
  Tray,
  Truck,
  Users,
  Wallet,
  type Icon,
} from '@phosphor-icons/react';
import type { Catalogue } from '../i18n/en';

type NavKey = keyof Catalogue['nav']['items'];
type TabKey = keyof Catalogue['nav']['tabs'];

/** A page that lives under a menu item as one of its tabs. */
export interface SectionTab {
  to: string;
  key: TabKey;
  /** Keep the address's filters (like the chosen period) when switching to this tab. */
  keepSearch?: boolean;
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
}

/**
 * Pages that share one menu item and switch with tabs at the top. Each keeps
 * its own address, so old links and bookmarks still open the right tab.
 */
export const SECTIONS = {
  stock: [
    { to: '/inventory', key: 'shelf' },
    { to: '/products', key: 'products' },
    { to: '/categories', key: 'categories' },
  ],
  sales: [
    { to: '/sales', key: 'history' },
    { to: '/documents', key: 'invoices' },
  ],
  day: [
    { to: '/day', key: 'close' },
    { to: '/cash', key: 'cash' },
    { to: '/carwash', key: 'carwash' },
  ],
  reports: [
    { to: '/report', key: 'report' },
    { to: '/reports', key: 'analytics', keepSearch: true },
    { to: '/reports/team', key: 'team', keepSearch: true },
    { to: '/reports/profit', key: 'profit', keepSearch: true },
    { to: '/reports/downloads', key: 'downloads', keepSearch: true },
  ],
} satisfies Record<string, SectionTab[]>;

/** Grouped by the job at hand: today, selling, the shelves, buying, the money, the team. */
export const NAV_GROUPS: Array<{ key: keyof Catalogue['nav']['groups']; items: NavItem[] }> = [
  {
    key: 'today',
    items: [
      { to: '/', key: 'overview', icon: House },
      { to: '/inbox', key: 'inbox', icon: Tray, badge: 'inbox' },
      { to: '/ask', key: 'ask', icon: Sparkle },
    ],
  },
  {
    key: 'sell',
    items: [
      { to: '/sales', key: 'sales', icon: Receipt, also: ['/documents'] },
      { to: '/customers', key: 'customers', icon: AddressBook },
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
      { to: '/suppliers', key: 'suppliers', icon: Storefront },
      { to: '/orders', key: 'orders', icon: Truck },
      { to: '/bills', key: 'bills', icon: Invoice },
    ],
  },
  {
    key: 'money',
    items: [
      { to: '/day', key: 'day', icon: Coins, also: ['/cash', '/carwash'] },
      { to: '/expenses', key: 'expenses', icon: Wallet },
      { to: '/report', key: 'reports', icon: ChartLine, also: ['/reports'] },
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

/** Whether the menu item is the one for this address (its own page, a tab under it, or a detail page). */
export function isCurrent(item: NavItem, pathname: string): boolean {
  if (item.to === '/') return pathname === '/';
  return [item.to, ...(item.also ?? [])].some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
