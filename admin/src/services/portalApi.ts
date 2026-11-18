import { API_URL, ApiError } from './apiClient';
import type { ProductUnit } from './types';
import type { Brand } from './types';

/**
 * The business customers' portal (step 15). It signs in with an httpOnly
 * cookie the server sets, never the dashboard's tokens, so these calls send
 * credentials and no Authorization header.
 */

export type PortalLanguage = 'sq' | 'en';
export type PortalOrderState = 'sent' | 'seen' | 'changed' | 'offered' | 'preparing' | 'on_the_way' | 'delivered' | 'done' | 'declined' | 'cancelled';

export interface PortalMe {
  /** Orders the shop changed that nobody here has opened yet. */
  unseenChanges: number;
  person: { name: string; email: string | null; language: PortalLanguage };
  customer: { name: string };
  canOrder: boolean;
  minOrder: number | null;
  shop: { name: string; phone: string | null; address: string | null };
  /** The shop's look: its name, mark and colours across the portal. */
  brand: Brand;
}

export interface PortalProduct {
  id: number;
  name: string;
  category: { id: number; name: string };
  imageUrl: string | null;
  unit: ProductUnit;
  vatRate: number;
  price: number;
  net: number;
  inStock: boolean;
}

export interface PortalPricedLine {
  productId: number;
  name: string;
  unit: ProductUnit;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  net: number;
  vat: number;
  total: number;
  inStock: boolean;
}

export interface PortalQuote {
  lines: PortalPricedLine[];
  net: number;
  vat: number;
  total: number;
  missing: number[];
  minOrder: number | null;
  canOrder: boolean;
}

export interface PortalOrder {
  id: number;
  at: string;
  state: PortalOrderState;
  net: number;
  vat: number;
  total: number;
  note: string | null;
  lineCount: number;
  by: string | null;
  declineReason: string | null;
  offer: { number: string; total: number } | null;
  invoice: { id: number; number: string } | null;
  deliverOn: string | null;
  change: PortalOrderChange | null;
}

/** An order as the customer last agreed it, before the shop's change. */
export interface PortalOrderSnapshot {
  net: number;
  vat: number;
  total: number;
  lines: Array<{ productId: number; name: string; unit: string; quantity: number; unitPrice: number; total: number }>;
}

export interface PortalOrderChange {
  reason: string;
  at: string;
  seen: boolean;
  agreed: boolean;
  previous: PortalOrderSnapshot | null;
}

export interface PortalOrderLine {
  productId: number;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  total: number;
  inStock: boolean;
}

export interface PortalOrderDetail extends PortalOrder {
  lines: PortalOrderLine[];
  canCancel: boolean;
  canAgree: boolean;
}

export interface PortalDocument {
  id: number;
  kind: 'invoice' | 'credit_note';
  number: string;
  issuedAt: string;
  dueDate: string | null;
  net: number;
  vat: number;
  total: number;
  onAccount: boolean;
  corrects: string | null;
}

export interface PortalAccount {
  balance: number;
  payLater: boolean;
  creditLimit: number | null;
  lateAmount: number;
  lateSince: string | null;
  lastPaymentAt: string | null;
  openItems: Array<{ documentId: number | null; number: string | null; date: string; dueDate: string | null; total: number; paid: number; left: number; late: boolean }>;
  shop: { name: string; bankName: string | null; iban: string | null };
}

export interface PortalStatement {
  from: string;
  to: string;
  opening: number;
  closing: number;
  lines: Array<{ date: string; kind: 'charge' | 'payment' | 'refund' | 'credit'; number: string | null; debit: number; credit: number; balance: number }>;
  customer: { name: string };
  shop: { name: string };
}

async function portalRequest<T>(path: string, options: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown; query?: Record<string, string | number | undefined> } = {}): Promise<T> {
  const url = new URL(`${API_URL}/api/portal${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError('offline', 0, 'NETWORK');
  }
  const body = (await response.json().catch(() => null)) as { data: T; message: string; error: string | null } | null;
  if (!response.ok || !body) throw new ApiError(body?.message ?? response.statusText, response.status, body?.error ?? null);
  return body.data;
}

export const portalApi = {
  requestLink: (email: string) => portalRequest<{ sent: true }>('/links', { method: 'POST', body: { email } }),
  peek: (token: string) => portalRequest<{ purpose: 'invite' | 'sign_in'; customer: string; name: string; shop: string; brand: Brand }>('/links/peek', { method: 'POST', body: { token } }),
  useLink: (token: string) => portalRequest<{ signedIn: true }>('/links/use', { method: 'POST', body: { token } }),
  signOut: () => portalRequest<{ signedOut: true }>('/sign-out', { method: 'POST' }),
  me: () => portalRequest<PortalMe>('/me'),
  setLanguage: (language: PortalLanguage) => portalRequest<{ language: PortalLanguage }>('/me/language', { method: 'PUT', body: { language } }),
  products: (query: { search?: string; categoryId?: number }) =>
    portalRequest<{ categories: Array<{ id: number; name: string }>; products: PortalProduct[] }>('/products', { query }),
  quote: (lines: Array<{ productId: number; quantity: number }>) => portalRequest<PortalQuote>('/quote', { method: 'POST', body: { lines } }),
  orders: () => portalRequest<PortalOrder[]>('/orders'),
  order: (id: number) => portalRequest<PortalOrderDetail>(`/orders/${id}`),
  send: (input: { lines: Array<{ productId: number; quantity: number }>; note: string | null }) => portalRequest<PortalOrderDetail>('/orders', { method: 'POST', body: input }),
  again: (id: number) => portalRequest<PortalQuote>(`/orders/${id}/again`),
  agree: (id: number) => portalRequest<PortalOrderDetail>(`/orders/${id}/agree`, { method: 'POST' }),
  cancel: (id: number) => portalRequest<PortalOrderDetail>(`/orders/${id}/cancel`, { method: 'POST' }),
  invoices: () => portalRequest<PortalDocument[]>('/invoices'),
  invoiceUrl: (id: number, language: PortalLanguage) => `${API_URL}/api/portal/invoices/${id}/print?language=${language}`,
  account: () => portalRequest<PortalAccount>('/account'),
  statement: (from: string, to: string) => portalRequest<PortalStatement>('/statement', { query: { from, to } }),
};
