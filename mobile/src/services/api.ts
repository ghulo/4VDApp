import { apiRequest, apiText, tokenStore } from './apiClient';
import type {
  DocumentRef,
  AppSettings,
  CarwashToday,
  CashPlace,
  CashPlaceToday,
  ShopDay,
  Customer,
  Delivery,
  ExpiryDate,
  TabEntry,
  Category,
  InventoryItem,
  MyRequest,
  MySales,
  PushSettings,
  PushTopic,
  PaginationMeta,
  Product,
  ReturnCondition,
  ReturnResult,
  Sale,
  StockCount,
  StockCountSummary,
  User,
  WriteOffReason,
  WriteOffResult,
} from './types';

const PAGE_SIZE = 20;

export const authApi = {
  async login(email: string, password: string): Promise<User> {
    const { data } = await apiRequest<{ token: string; refreshToken: string; user: User }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    await tokenStore.save(data.token, data.refreshToken);
    return data.user;
  },

  me: async () => (await apiRequest<User>('/auth/me')).data,

  async logout(): Promise<void> {
    try {
      await apiRequest('/auth/logout', { method: 'POST', body: { refreshToken: tokenStore.refresh ?? undefined } });
    } finally {
      await tokenStore.clear();
    }
  },
};

/** The signed-in person's own profile. */
export const meApi = {
  updateProfile: async (changes: { name?: string; phone?: string | null; theme?: User['theme']; language?: User['language'] }) =>
    (await apiRequest<User>('/me/profile', { method: 'PUT', body: changes })).data,
  uploadAvatar: async (file: Blob) => (await apiRequest<User>('/me/avatar', { method: 'PUT', file })).data,
  removeAvatar: async () => (await apiRequest<User>('/me/avatar', { method: 'DELETE' })).data,
};

export interface ProductQuery {
  page: number;
  limit?: number;
  search?: string;
  categoryId?: number;
  inStock?: boolean;
}

export const productsApi = {
  async list(query: ProductQuery): Promise<{ items: Product[]; meta: PaginationMeta }> {
    const { data, meta } = await apiRequest<Product[]>('/products', { query: { limit: PAGE_SIZE, ...query } });
    return { items: data, meta: meta! };
  },
  get: async (id: number) => (await apiRequest<Product>(`/products/${id}`)).data,
  byBarcode: async (barcode: string) => (await apiRequest<Product>(`/products/barcode/${encodeURIComponent(barcode)}`)).data,
};

export const categoriesApi = {
  list: async () => (await apiRequest<Category[]>('/categories')).data,
};

export const favoritesApi = {
  list: async () => (await apiRequest<Product[]>('/favorites')).data,
  ids: async () => (await apiRequest<number[]>('/favorites/ids')).data,
  add: async (productId: number) => {
    await apiRequest(`/favorites/${productId}`, { method: 'PUT' });
  },
  remove: async (productId: number) => {
    await apiRequest(`/favorites/${productId}`, { method: 'DELETE' });
  },
};

export const documentsApi = {
  /** The invoice as a printable A4 page, in the reader's language. */
  printPage: (id: number) => apiText(`/documents/${id}/print`),
};

export const salesApi = {
  recordBasket: async (input: { items: Array<{ productId: number; quantity: number }>; notes: string | null; customerId?: number }) =>
    (await apiRequest<{ sales: Sale[]; total: number; invoice: DocumentRef }>('/sales/basket', { method: 'POST', body: input })).data,
  record: async (input: { productId: number; quantity: number; notes: string | null; customerId?: number }) =>
    (await apiRequest<Sale>('/sales', { method: 'POST', body: input })).data,
};

export const pushApi = {
  settings: async () => (await apiRequest<PushSettings>('/notifications/push')).data,
  updatePreferences: async (changes: Partial<Record<PushTopic, boolean>>) =>
    (await apiRequest<PushSettings>('/notifications/push/preferences', { method: 'PUT', body: changes })).data,
  addDevice: async (
    device: { kind: 'expo'; token: string } | { kind: 'web'; endpoint: string; keys: { p256dh: string; auth: string } },
  ) => (await apiRequest<PushSettings>('/notifications/push/devices', { method: 'POST', body: device })).data,
  sendTest: async () => {
    await apiRequest('/notifications/push/test', { method: 'POST' });
  },
  removeDevice: async (token: string) =>
    (await apiRequest<PushSettings>('/notifications/push/devices', { method: 'DELETE', body: { token } })).data,
};

export const reportsApi = {
  mySales: async (range: { startDate: string; endDate: string; previousStartDate: string; previousEndDate: string }) => {
    const { startDate, endDate, previousStartDate, previousEndDate } = range;
    const query = { startDate, endDate, previousStartDate, previousEndDate };
    return (await apiRequest<MySales>('/reports/my-sales', { query })).data;
  },
};

export const inventoryApi = {
  /** Low and sold-out products, emptiest first. */
  async lowStock(limit: number): Promise<{ items: InventoryItem[]; meta: PaginationMeta }> {
    const { data, meta } = await apiRequest<InventoryItem[]>('/inventory', { query: { lowStock: true, limit } });
    return { items: data, meta: meta! };
  },
};

export const settingsApi = {
  get: async () => (await apiRequest<AppSettings>('/settings')).data,
};

export const returnsApi = {
  request: async (
    saleId: number,
    input: { quantity: number; condition: ReturnCondition; refundAmount?: number; notes: string | null },
  ) => (await apiRequest<ReturnResult>(`/sales/${saleId}/returns`, { method: 'POST', body: input })).data,
};

export const writeOffsApi = {
  request: async (input: { productId: number; quantity: number; reason: WriteOffReason; notes: string | null }) =>
    (await apiRequest<WriteOffResult>('/write-offs', { method: 'POST', body: input })).data,
};

export const expiryApi = {
  forProduct: async (productId: number) => (await apiRequest<ExpiryDate[]>('/expiry', { query: { productId } })).data,
  add: async (input: { productId: number; quantity: number; expiresOn: string; note: string | null }) =>
    (await apiRequest<ExpiryDate>('/expiry', { method: 'POST', body: input })).data,
  clear: async (id: number) => {
    await apiRequest(`/expiry/${id}/clear`, { method: 'POST' });
  },
};

export const deliveriesApi = {
  list: async () => (await apiRequest<Delivery[]>('/orders/deliveries')).data,
  receive: async (orderId: number, lines: Array<{ lineId: number; receivedQuantity: number; expiresOn: string | null }>) => {
    await apiRequest(`/orders/${orderId}/receive`, { method: 'POST', body: { lines } });
  },
};

export const carwashApi = {
  today: async () => (await apiRequest<{ day: string; carwashes: CarwashToday[] }>('/carwash/today')).data,
  save: async (carwashId: number, day: string, takings: { carwash: number; change: number }) => {
    await apiRequest(`/carwash/${day}`, { method: 'PUT', body: { carwashId, ...takings } });
  },
};

export const customersApi = {
  list: async () => (await apiRequest<Customer[]>('/customers')).data,
  detail: async (id: number) => (await apiRequest<Customer & { entries: TabEntry[] }>(`/customers/${id}`)).data,
  create: async (input: { name: string; kind: Customer['kind']; nui: string | null; phone: string | null; note: string | null }) =>
    (await apiRequest<Customer>('/customers', { method: 'POST', body: input })).data,
  pay: async (id: number, input: { amount: number; note: string | null }) =>
    (await apiRequest<Customer>(`/customers/${id}/payments`, { method: 'POST', body: input })).data,
};

export const dayApi = {
  /** Today's steps for closing up, defined by the server. */
  today: async () => (await apiRequest<ShopDay>('/day')).data,
};

export const cashApi = {
  today: async () => (await apiRequest<CashPlaceToday[]>('/cash-counts/today')).data,
  count: async (input: { place: CashPlace; carwashId?: number; counted: number; float?: number; note: string | null }) => {
    await apiRequest('/cash-counts', { method: 'POST', body: input });
  },
};

export const countsApi = {
  list: async () => (await apiRequest<StockCountSummary[]>('/stock-counts')).data,
  get: async (id: number) => (await apiRequest<StockCount>(`/stock-counts/${id}`)).data,
  start: async (categoryId: number | null) =>
    (await apiRequest<StockCount>('/stock-counts', { method: 'POST', body: { categoryId } })).data,
  count: async (id: number, productId: number, countedQuantity: number) =>
    (await apiRequest<StockCount>(`/stock-counts/${id}/lines/${productId}`, { method: 'PUT', body: { countedQuantity } })).data,
  submit: async (id: number) => (await apiRequest<StockCount>(`/stock-counts/${id}/submit`, { method: 'POST' })).data,
};

export const approvalsApi = {
  mine: async () => (await apiRequest<MyRequest[]>('/approvals/mine')).data,
};
