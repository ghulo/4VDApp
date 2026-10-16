// Mirrors the shapes the backend returns (see its DTOs in backend/src/services).

export type UserRole = 'developer' | 'admin' | 'owner' | 'employee' | 'family';

export interface User {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  phone: string | null;
  /** Path to the photo (use mediaSrc); null shows initials. */
  avatarUrl: string | null;
  theme: 'light' | 'dark' | 'system';
  /** The language they read 4VD in. */
  language: 'en' | 'sq';
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export interface PricingTier {
  quantity: number;
  price: number;
}

export interface Category {
  id: number;
  name: string;
  productCount?: number;
}

export interface Product {
  id: number;
  name: string;
  description: string | null;
  sku: string | null;
  /** Scanned at the counter. */
  barcode: string | null;
  imageUrl: string | null;
  category: { id: number; name: string };
  price: number;
  /** Two-letter code of the country it comes from, or null. */
  originCountry: string | null;
  /** Percent of VAT in the price. */
  vatRate: number;
  isActive: boolean;
  /** Only sent to the people who run the shop. */
  costPrice?: number | null;
  stock: { quantity: number; reorderLevel: number; isInStock: boolean; isLowStock: boolean };
  bulkPricingTiers: PricingTier[];
  /** The running promotion, with the price it gives for one unit. */
  promotion: { id: number; name: string; percentOff: number; endsAt: string; price: number } | null;
}

export interface Sale {
  id: number;
  productName: string;
  quantity: number;
  pricePerUnit: number;
  totalAmount: number;
}

/** An invoice or credit note, by its number. */
export interface DocumentRef {
  id: number;
  number: string;
}

/** One product within a checkout, with how many have come back. */
export interface SaleLine {
  id: number;
  productId: number;
  productName: string;
  quantity: number;
  pricePerUnit: number;
  totalAmount: number;
  saleDate: string;
  /** Units returned or waiting for a return decision. */
  returnedQuantity: number;
}

/** Everything one customer bought at once: one invoice, one or more lines. */
export interface Checkout {
  key: string;
  invoice: DocumentRef | null;
  saleDate: string;
  total: number;
  lines: SaleLine[];
}

export interface SalesTotals {
  salesCount: number;
  unitsSold: number;
  /** After refunds. */
  revenue: number;
  refunds: number;
}

export interface RecentSale {
  id: number;
  productName: string;
  quantity: number;
  pricePerUnit: number;
  totalAmount: number;
  saleDate: string;
  /** Units returned or waiting for the owner's decision. */
  returnedQuantity: number;
}

export interface MySales {
  /** Euros of sales (after refunds) the owner hopes for each month; null when not set. */
  monthlyTarget: number | null;
  current: SalesTotals;
  previous: SalesTotals;
  recentSales: RecentSale[];
}

export interface InventoryItem {
  productId: number;
  productName: string;
  sku: string | null;
  quantity: number;
  reorderLevel: number;
  isLowStock: boolean;
}

export interface AppSettings {
  refundApprovalLimit: number;
  returnWindowDays: number;
  /** The most rabat, in percent, an employee may give; owners and admins may give any. */
  employeeDiscountLimit: number;
}

export interface Customer {
  id: number;
  name: string;
  kind: 'person' | 'business';
  /** A business's NUI; null for a person. */
  nui: string | null;
  phone: string | null;
  note: string | null;
  balance: number;
  owingSince: string | null;
  lastPaymentAt: string | null;
  archived: boolean;
}

export interface TabEntry {
  id: number;
  /** A refund is a return taken off the tab. */
  kind: 'charge' | 'payment' | 'refund';
  amount: number;
  note: string | null;
  saleId: number | null;
  undone: boolean;
  at: string;
  by: string | null;
}

/** A supplier order on its way, as the counter sees it (no costs). */
export interface Delivery {
  id: number;
  supplierName: string;
  note: string | null;
  createdAt: string;
  lines: Array<{ id: number; productId: number; productName: string; sku: string | null; quantity: number }>;
}

export type CashPlace = 'shop' | 'carwash';

/** An open carwash and what was entered for it today (null when nothing yet). */
export interface CarwashToday {
  id: number;
  name: string;
  takings: { carwash: number; change: number } | null;
}

/** Something someone must act on, worked out by the server from the shop's state (DESIGN.md 3.3). */
export interface TodoItem {
  key: string;
  kind: string;
  severity: 'urgent' | 'check' | 'idea';
  title: string;
  detail: string;
  verb: string;
}

/** The same list the dashboard's Inbox shows; `count` is the one "waiting" number. */
export interface Attention {
  todo: TodoItem[];
  count: number;
}

/** One thing that closes the day, as the server defines it for both apps. */
export type DayStep =
  | { kind: 'drawer'; key: string; place: CashPlace; carwashId: number | null; name: string | null; done: boolean; countedBy: string | null }
  | { kind: 'carwash'; key: string; carwashId: number; name: string; done: boolean }
  | { kind: 'expenses'; key: 'expenses'; done: boolean; count: number; total: number; noneMarked: boolean; noneMarkedBy: string | null }
  | { kind: 'requests'; key: 'requests'; done: boolean; waiting: number };

/** Today's close-the-day steps (staff get only the ones they close at the counter). */
export interface ShopDay {
  day: string;
  today: string;
  steps: DayStep[];
  done: number;
  total: number;
  allDone: boolean;
}

/** Whether a drawer was counted today; never what the app expects (staff count blind). */
export interface CashPlaceToday {
  place: CashPlace;
  carwashId: number | null;
  /** The carwash's name; null for the shop. */
  name: string | null;
  float: number;
  countedBy: string | null;
  countedAt: string | null;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ReturnCondition = 'resellable' | 'damaged';
export const WRITE_OFF_REASONS = ['damaged', 'lost', 'expired', 'other'] as const;
export type WriteOffReason = (typeof WRITE_OFF_REASONS)[number];
export type CountStatus = 'open' | 'submitted' | 'closed' | 'cancelled';

export interface ReturnResult {
  id: number;
  status: ApprovalStatus;
  quantity: number;
  refundAmount: number;
  needsApprovalBecause: string[];
}

export interface ExpiryDate {
  id: number;
  productId: number;
  productName: string;
  /** Units noted when the date was added. */
  quantity: number;
  /** How many of them are probably still on the shelf. */
  remaining: number;
  /** "2026-10-12" */
  expiresOn: string;
  /** Negative once it has passed. */
  daysLeft: number;
  note: string | null;
  addedBy: string | null;
}

export interface WriteOffResult {
  id: number;
  status: ApprovalStatus;
  quantity: number;
}

export interface StockCountSummary {
  id: number;
  category: { id: number; name: string } | null;
  status: CountStatus;
  startedBy: { id: number; name: string } | null;
  startedAt: string;
}

export interface StockCountLine {
  productId: number;
  productName: string;
  sku: string | null;
  categoryName: string;
  countedQuantity: number | null;
}

export interface StockCount extends StockCountSummary {
  totals: { products: number; counted: number };
  lines: StockCountLine[];
}

/** A product someone asked to add; approving it creates the product. */
/** How one device fared with the test alert. */
export interface TestDelivery {
  kind: 'expo' | 'web';
  /** Apple, Google, Microsoft, Mozilla or Expo. */
  service: string;
  delivered: boolean;
  problem: string | null;
  /** The push service no longer knew it, so it was removed. */
  removed: boolean;
}

/** A product someone asked to add; approving it creates the product. */
export interface ProductRequest {
  id: number;
  status: 'pending' | 'approved' | 'rejected';
  name: string;
  category: { id: number; name: string } | null;
  price: number;
  vatRate: number;
  barcode: string | null;
  originCountry: string | null;
  photoUrl: string | null;
  stock: number;
  note: string | null;
  requestedBy: { id: number; name: string } | null;
  requestedAt: string;
}

export interface NewProductInput {
  name: string;
  categoryId: number | null;
  price: number;
  barcode: string | null;
  stock: number;
  note: string | null;
  photo: { mime: string; data: string } | null;
}

/** A new product either went straight in (for whoever runs the shop) or waits as a request. */
export type NewProductOutcome = { kind: 'product'; productId: number } | { kind: 'request'; request: ProductRequest };

type PersonRef = { id: number; name: string };

/** A return waiting for a decision. */
export interface PendingReturn {
  id: number;
  productName: string;
  quantity: number;
  refundAmount: number;
  condition: 'resellable' | 'damaged';
  notes: string | null;
  needsApprovalBecause: string[];
  requestedBy: PersonRef | null;
  requestedAt: string;
}

/** Damaged, lost or expired stock waiting for a decision. */
export interface PendingWriteOff {
  id: number;
  productName: string;
  quantity: number;
  reason: string;
  value: number | null;
  notes: string | null;
  requestedBy: PersonRef | null;
  requestedAt: string;
}

/** A scanned bill as the phone checks it; `input` is set when it can be confirmed here. */
export interface QuickBillCheck {
  id: number;
  supplierName: string | null;
  number: string | null;
  amount: number | null;
  scannedBy: string | null;
  scannedAt: string;
  pages: Array<{ url: string; isPdf: boolean }>;
  lines: Array<{ name: string; product: string | null; pieces: number; unitCost: number | null; oldCost: number | null; stamp: 'new' | 'unsure' | 'barcode' | 'price' | 'match' }>;
  blockers: Array<'decided' | 'supplier' | 'duplicate' | 'totals' | 'no_lines' | 'new_product' | 'unsure' | 'amount'>;
  input: unknown;
}

/** A scanned bill waiting to be checked. */
export interface WaitingBill {
  id: number;
  supplierName: string | null;
  number: string | null;
  amount: number | null;
  scannedBy: string | null;
  scannedAt: string;
}

export interface MyRequest {
  type: 'return' | 'write_off' | 'count' | 'sale' | 'product' | 'bill';
  id: number;
  summary: string;
  status: string;
  decisionNote: string | null;
  requestedAt: string;
  decidedAt: string | null;
}

export type PushTopic = 'stock' | 'approvals' | 'decisions' | 'summary';

export interface PushSettings {
  topics: Array<{ topic: PushTopic; enabled: boolean }>;
  /** Phones and browsers getting this person's alerts. */
  deviceCount: number;
  /** Alerts are on in the dashboard, so the team app stays quiet for this person. */
  dashboardOnly: boolean;
  /** Null when the server has no Web Push keys. */
  webPushPublicKey: string | null;
}

/** How you sign in: whether a password is set, and the Google account linked, if any. */
export interface Security {
  hasPassword: boolean;
  googleEmail: string | null;
}

/** One place you're logged in. */
export interface Session {
  id: string;
  device: string;
  ip: string | null;
  lastUsedAt: string | null;
  startedAt: string;
  current: boolean;
}
