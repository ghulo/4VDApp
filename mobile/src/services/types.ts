// Mirrors the shapes the backend returns (see docs/API.md).

export type UserRole = 'admin' | 'employee' | 'family';

export interface User {
  id: number;
  email: string;
  name: string;
  role: UserRole;
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
  type: 'return' | 'write_off' | 'count';
  id: number;
  summary: string;
  status: string;
  decisionNote: string | null;
  requestedAt: string;
  decidedAt: string | null;
}
