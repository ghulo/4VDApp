import { apiRequest, tokenStore } from './apiClient';
import type {
  AppSettings,
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

export const salesApi = {
  record: async (input: { productId: number; quantity: number; notes: string | null }) =>
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
