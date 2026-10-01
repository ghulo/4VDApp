// Mirrors the shapes the backend returns (see docs/API.md).

export type UserRole = 'admin' | 'employee' | 'family';

export interface User {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export interface Paginated<TItem> {
  items: TItem[];
  meta: PaginationMeta;
}

export interface PricingTier {
  quantity: number;
  price: number;
}

export interface Category {
  id: number;
  name: string;
  description: string | null;
  productCount?: number;
}

export interface Product {
  id: number;
  name: string;
  description: string | null;
  sku: string | null;
  imageUrl: string | null;
  isActive: boolean;
  category: { id: number; name: string };
  price: number;
  costPrice?: number | null;
  stock: { quantity: number; reorderLevel: number; isInStock: boolean; isLowStock: boolean };
  bulkPricingTiers: PricingTier[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  name: string;
  description: string | null;
  categoryId: number;
  price: number;
  costPrice: number | null;
  imageUrl: string | null;
  sku: string | null;
  isActive: boolean;
  bulkPricingTiers: PricingTier[];
  stock?: number;
  reorderLevel?: number;
}

export interface InventoryItem {
  productId: number;
  productName: string;
  sku: string | null;
  quantity: number;
  reorderLevel: number;
  isLowStock: boolean;
  lastRestockedAt: string | null;
  updatedAt: string;
}

export interface StockAdjustment {
  id: number;
  quantity: number;
  reason: string;
  notes: string | null;
  adjustedBy: string | null;
  date: string;
}

export interface InventoryDetail extends InventoryItem {
  warnings: string[];
  recentAdjustments: StockAdjustment[];
}

export const MANUAL_STOCK_REASONS = ['Restock', 'Return', 'Damage', 'Recount', 'Manual adjustment'] as const;
export type StockReason = (typeof MANUAL_STOCK_REASONS)[number];

export interface Sale {
  id: number;
  productId: number;
  productName: string;
  quantity: number;
  pricePerUnit: number;
  totalAmount: number;
  soldBy: string | null;
  saleDate: string;
  notes: string | null;
}

export interface Dashboard {
  periodDays: number;
  totalSales: number;
  unitsSold: number;
  totalRevenue: number;
  totalProfit: number;
  topProducts: Array<{ productId: number; productName: string; unitsSold: number; revenue: number }>;
  lowStockCount: number;
  inventoryValue: number;
}

export interface RevenuePoint {
  periodStart: string;
  revenue: number;
  unitsSold: number;
  salesCount: number;
}

export interface RevenueSeries {
  period: 'daily' | 'weekly' | 'monthly';
  totalRevenue: number;
  points: RevenuePoint[];
}

export interface AppNotification {
  id: number;
  title: string;
  message: string;
  type: string | null;
  isRead: boolean;
  createdAt: string;
}

export const USER_ROLES: UserRole[] = ['admin', 'employee', 'family'];

export interface PeriodTotals {
  revenue: number;
  revenueWithoutCost: number;
  cost: number;
  profit: number;
  margin: number | null;
  unitsSold: number;
  salesCount: number;
}

export interface ReportSummary {
  current: PeriodTotals;
  previous: PeriodTotals;
  change: { revenue: number | null; profit: number | null; unitsSold: number | null; salesCount: number | null };
}

export interface TeamRow {
  userId: number;
  name: string;
  role: UserRole;
  /** Deactivated or removed since; kept so their past sales still show. */
  hasLeft: boolean;
  salesCount: number;
  unitsSold: number;
  revenue: number;
  profit: number;
  averageSale: number;
}

export interface ProfitRow {
  id: number;
  name: string;
  unitsSold: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number | null;
  hasUnknownCost: boolean;
}

export interface ReorderSuggestion {
  productId: number;
  productName: string;
  quantity: number;
  reorderLevel: number;
  averageDailySales: number;
  daysLeft: number | null;
  suggestedOrder: number;
}

export interface ActivityEntry {
  id: number;
  action: string;
  entityType: string | null;
  entityId: number | null;
  summary: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  user: { id: number; name: string } | null;
}
