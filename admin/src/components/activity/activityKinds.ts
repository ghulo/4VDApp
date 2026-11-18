import { AddressBook, ArrowCounterClockwise, ArrowUUpLeft, Drop, FileText, Gear, type Icon, Money, Package, Percent, Receipt, SignIn, Tag, Truck, User, Wallet } from '@phosphor-icons/react';
import type { Catalogue } from '../../i18n/en';

/** What a change was about, by the first word of its action ("sale.recorded" → sale). */
export const ACTIVITY_ICONS: Record<string, Icon> = {
  sale: Receipt,
  return: ArrowUUpLeft,
  promotion: Percent,
  document: FileText,
  product: Tag,
  pricing: Tag,
  category: Tag,
  stock: Package,
  count: Package,
  expiry: Package,
  write_off: Package,
  order: Truck,
  bill: Truck,
  supplier: Truck,
  cash: Money,
  expense: Wallet,
  carwash: Drop,
  customer: AddressBook,
  tab: AddressBook,
  user: User,
  auth: SignIn,
  settings: Gear,
  business: Gear,
  undo: ArrowCounterClockwise,
};

/**
 * Kinds of change a person would filter by, mapped to action prefixes. The
 * default leaves logins out: they outnumber real changes and bury what can be undone.
 */
export const ACTIVITY_KINDS: Array<{ value: string; key: keyof Catalogue['activity']['kinds'] }> = [
  { value: '', key: 'all' },
  { value: 'sale,return,promotion,document', key: 'sales' },
  { value: 'product,pricing,category,stock,count,expiry,write_off', key: 'stock' },
  { value: 'order,bill,supplier', key: 'buying' },
  { value: 'cash,expense,carwash,customer,tab', key: 'money' },
  { value: 'user,settings,business', key: 'people' },
  { value: 'auth', key: 'logins' },
];
