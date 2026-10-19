import { CashRegister, House, Package, UserCircle, type Icon } from '@phosphor-icons/react';
import type { Catalogue } from '../i18n/en';

/** The staff layout's bottom tabs: what the team app had, in the same order. */
export const STAFF_TABS: Array<{ to: string; key: keyof Catalogue['staff']['nav']; icon: Icon; also?: string[] }> = [
  { to: '/', key: 'home', icon: House, also: ['/my-sales', '/shift', '/new-product', '/deliveries', '/tabs', '/counts', '/scan-bill'] },
  { to: '/catalog', key: 'products', icon: Package },
  { to: '/counter', key: 'sell', icon: CashRegister },
  { to: '/profile', key: 'account', icon: UserCircle },
];

/** The pages someone on the staff layout may open; everything else sends them Home. The server checks again. */
const STAFF_PATHS = [
  /^\/$/,
  /^\/counter(\/|$)/,
  /^\/catalog(\/|$)/,
  /^\/my-sales$/,
  /^\/shift$/,
  /^\/new-product$/,
  /^\/deliveries$/,
  /^\/tabs(\/\d+)?$/,
  /^\/counts(\/\d+(\/count)?)?$/,
  /^\/scan-bill$/,
  /^\/scan\/[^/]+$/,
  /^\/profile(\/|$)/,
];

export const staffMayOpen = (pathname: string): boolean => STAFF_PATHS.some((path) => path.test(pathname));

/** Which bottom tab an address belongs to. */
export function staffTabFor(pathname: string): string {
  const tab = STAFF_TABS.find((item) =>
    item.to === '/'
      ? pathname === '/' || (item.also ?? []).some((path) => pathname === path || pathname.startsWith(`${path}/`))
      : pathname === item.to || pathname.startsWith(`${item.to}/`),
  );
  return tab?.to ?? '/';
}
