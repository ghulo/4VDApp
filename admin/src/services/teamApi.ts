import { apiRequest } from './apiClient';
import type { Checkout, Product, ProductRequest, StockCount } from './types';

// What the counter staff do from a phone: the calls the team app made, now in
// the dashboard. The server decides what each role may see (no costs for the
// counter); these only carry it.

export interface SalesTotals {
  revenue: number;
  salesCount: number;
  unitsSold: number;
  refunds: number;
}

export interface MySales {
  /** Euros of sales (after refunds) the owner hopes for each month; null when not set. */
  monthlyTarget: number | null;
  current: SalesTotals;
  previous: SalesTotals;
}

/** Something this person asked for (a return, a write-off, a new product…) and where it stands. */
export interface MyRequest {
  type: 'return' | 'write_off' | 'count' | 'sale' | 'product' | 'bill';
  id: number;
  summary: string;
  status: string;
  decisionNote: string | null;
  requestedAt: string;
  decidedAt: string | null;
}

/** A supplier order on its way, as the counter sees it (no costs). */
export interface Delivery {
  id: number;
  supplierName: string;
  note: string | null;
  createdAt: string;
  lines: Array<{ id: number; productId: number; productName: string; sku: string | null; quantity: number }>;
}

/** An open carwash and what was entered for it today (null when nothing yet). */
export interface CarwashToday {
  id: number;
  name: string;
  takings: { carwash: number; change: number } | null;
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

export interface Range {
  startDate: string;
  endDate: string;
}

export interface RangeWithPrevious extends Range {
  previousStartDate: string;
  previousEndDate: string;
}

export const MY_SALES_KEY = ['reports', 'my-sales'];
export const DELIVERIES_KEY = ['orders', 'deliveries'];
export const FAVORITES_KEY = ['favorites'];

export const teamApi = {
  mySales: async ({ startDate, endDate, previousStartDate, previousEndDate }: RangeWithPrevious) =>
    (await apiRequest<MySales>('/reports/my-sales', { query: { startDate, endDate, previousStartDate, previousEndDate } })).data,
  /** Your own sales as whole checkouts (one invoice each), newest first. */
  myCheckouts: async ({ startDate, endDate, limit }: Range & { limit: number }) =>
    (await apiRequest<{ checkouts: Checkout[] }>('/sales/checkouts/mine', { query: { startDate, endDate, limit } })).data.checkouts,
  myRequests: async () => (await apiRequest<MyRequest[]>('/approvals/mine')).data,

  favoriteIds: async () => (await apiRequest<number[]>('/favorites/ids')).data,
  favorites: async () => (await apiRequest<Product[]>('/favorites')).data,
  addFavorite: async (productId: number) => {
    await apiRequest(`/favorites/${productId}`, { method: 'PUT' });
  },
  removeFavorite: async (productId: number) => {
    await apiRequest(`/favorites/${productId}`, { method: 'DELETE' });
  },

  deliveries: async () => (await apiRequest<Delivery[]>('/orders/deliveries')).data,
  receive: async (orderId: number, lines: Array<{ lineId: number; receivedQuantity: number; expiresOn: string | null }>) => {
    await apiRequest(`/orders/${orderId}/receive`, { method: 'POST', body: { lines } });
  },

  carwashToday: async () => (await apiRequest<{ day: string; carwashes: CarwashToday[] }>('/carwash/today')).data,
  saveCarwash: async (carwashId: number, day: string, takings: { carwash: number; change: number }) => {
    await apiRequest(`/carwash/${day}`, { method: 'PUT', body: { carwashId, ...takings } });
  },

  countLine: async (countId: number, productId: number, countedQuantity: number) =>
    (await apiRequest<StockCount>(`/stock-counts/${countId}/lines/${productId}`, { method: 'PUT', body: { countedQuantity } })).data,
  submitCount: async (countId: number) => (await apiRequest<StockCount>(`/stock-counts/${countId}/submit`, { method: 'POST' })).data,

  newProduct: async (input: NewProductInput) =>
    (await apiRequest<NewProductOutcome>('/product-requests', { method: 'POST', body: input })).data,
};

/** Today in this device's own timezone, with yesterday as the comparison. */
export function dayRange(now = new Date()): RangeWithPrevious {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    startDate: today.toISOString(),
    endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString(),
    previousStartDate: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toISOString(),
    previousEndDate: today.toISOString(),
  };
}

/** This calendar month, with last calendar month as the comparison. */
export function monthRange(now = new Date()): RangeWithPrevious & { start: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    start,
    startDate: start.toISOString(),
    endDate: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
    previousStartDate: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(),
    previousEndDate: start.toISOString(),
  };
}

/** "3 × Milk, 2 × Bread" for a checkout's lines. */
export function checkoutSummary(checkout: Checkout): string {
  return checkout.lines.map((line) => `${line.quantity} × ${line.productName}`).join(', ');
}
