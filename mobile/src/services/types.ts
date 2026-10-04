// Mirrors the shapes the backend returns (see docs/API.md).

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
  imageUrl: string | null;
  category: { id: number; name: string };
  price: number;
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
}

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  note: string | null;
  balance: number;
  owingSince: string | null;
  lastPaymentAt: string | null;
  archived: boolean;
}

export interface TabEntry {
  id: number;
  kind: 'charge' | 'payment';
  amount: number;
  note: string | null;
  saleId: number | null;
  undone: boolean;
  at: string;
  by: string | null;
}

export type CashPlace = 'shop' | 'carwash';

/** Whether a drawer was counted today; never what the app expects (staff count blind). */
export interface CashPlaceToday {
  place: CashPlace;
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

export interface MyRequest {
  type: 'return' | 'write_off' | 'count' | 'sale';
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
  /** Null when the server has no Web Push keys. */
  webPushPublicKey: string | null;
}
