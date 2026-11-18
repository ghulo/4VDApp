import { CashRegister, House, Package, UserCircle, type Icon } from '@phosphor-icons/react';
import { browseOnly, canSell } from '../auth/roles';
import type { Catalogue } from '../i18n/en';
import type { UserRole } from '../services/types';

/** The staff layout's bottom tabs: what the team app had, in the same order. */
export const STAFF_TABS: Array<{ to: string; key: keyof Catalogue['staff']['nav']; icon: Icon; also?: string[] }> = [
  { to: '/', key: 'home', icon: House, also: ['/my-sales', '/shift', '/new-product', '/deliveries', '/to-deliver', '/tabs', '/counts', '/scan-bill'] },
  { to: '/catalog', key: 'products', icon: Package },
  { to: '/counter', key: 'sell', icon: CashRegister },
  { to: '/profile', key: 'account', icon: UserCircle },
];

/** Family browses: Products and Account, plus Sell if their main admin gave family the sell power. */
const BROWSE_TABS = ['/catalog', '/counter', '/profile'];

/** The tabs one person sees. */
export function staffTabs(role: UserRole): typeof STAFF_TABS {
  if (!browseOnly(role)) return STAFF_TABS;
  return STAFF_TABS.filter((tab) => BROWSE_TABS.includes(tab.to) && (tab.to !== '/counter' || canSell(role)));
}

/** Family's pages: the product list and pages, scanning a label, their account (and the Counter with the sell power). */
const BROWSE_PATHS = [/^\/catalog(\/|$)/, /^\/scan\/[^/]+$/, /^\/profile(\/|$)/];

/** The pages someone on the staff layout may open; everything else sends them Home. The server checks again. */
const STAFF_PATHS = [
  /^\/$/,
  /^\/counter(\/|$)/,
  /^\/catalog(\/|$)/,
  /^\/my-sales$/,
  /^\/shift$/,
  /^\/new-product$/,
  /^\/deliveries$/,
  /^\/to-deliver$/,
  /^\/tabs(\/\d+)?$/,
  /^\/counts(\/\d+(\/count)?)?$/,
  /^\/scan-bill$/,
  /^\/scan\/[^/]+$/,
  /^\/profile(\/|$)/,
];

export function staffMayOpen(pathname: string, role: UserRole): boolean {
  if (!browseOnly(role)) return STAFF_PATHS.some((path) => path.test(pathname));
  // Home sends family on to Products (App.tsx), so / stays open.
  return pathname === '/' || BROWSE_PATHS.some((path) => path.test(pathname)) || (canSell(role) && /^\/counter(\/|$)/.test(pathname));
}

/** Which bottom tab an address belongs to. */
export function staffTabFor(pathname: string, tabs: typeof STAFF_TABS = STAFF_TABS): string {
  const tab = tabs.find((item) =>
    item.to === '/'
      ? pathname === '/' || (item.also ?? []).some((path) => pathname === path || pathname.startsWith(`${path}/`))
      : pathname === item.to || pathname.startsWith(`${item.to}/`),
  );
  return tab?.to ?? tabs[0].to;
}
