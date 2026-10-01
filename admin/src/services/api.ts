import { apiDownload, apiRequest, saveDownload, tokenStore } from './apiClient';
import type {
  ActivityEntry,
  AppNotification,
  Category,
  Dashboard,
  InventoryDetail,
  InventoryItem,
  Paginated,
  PricingTier,
  Product,
  ProductInput,
  ProfitRow,
  ReorderSuggestion,
  ReportSummary,
  RevenueSeries,
  Sale,
  StockReason,
  TeamRow,
  User,
  UserRole,
} from './types';

async function paginated<TItem>(path: string, query: Record<string, string | number | boolean | undefined>) {
  const { data, meta } = await apiRequest<TItem[]>(path, { query });
  return { items: data, meta: meta! } satisfies Paginated<TItem>;
}

export const authApi = {
  async login(email: string, password: string): Promise<User> {
    const { data } = await apiRequest<{ token: string; refreshToken: string; user: User }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    tokenStore.save(data.token, data.refreshToken);
    return data.user;
  },

  async me(): Promise<User> {
    return (await apiRequest<User>('/auth/me')).data;
  },

  async logout(): Promise<void> {
    const refreshToken = tokenStore.refresh ?? undefined;
    try {
      await apiRequest('/auth/logout', { method: 'POST', body: { refreshToken } });
    } finally {
      // Log out locally even if the server is unreachable.
      tokenStore.clear();
    }
  },
};

export interface ProductListQuery {
  page: number;
  limit?: number;
  search?: string;
  categoryId?: number;
  inStock?: boolean;
}

export const productsApi = {
  list: (query: ProductListQuery) => paginated<Product>('/products', { limit: 20, ...query }),
  get: async (id: number) => (await apiRequest<Product>(`/products/${id}`)).data,
  create: async (input: ProductInput) =>
    (await apiRequest<Product>('/products', { method: 'POST', body: input })).data,
  update: async (id: number, input: ProductInput) =>
    (await apiRequest<Product>(`/products/${id}`, { method: 'PUT', body: input })).data,
  remove: async (id: number) => {
    await apiRequest(`/products/${id}`, { method: 'DELETE' });
  },
};

export const categoriesApi = {
  list: async () => (await apiRequest<Category[]>('/categories')).data,
  create: async (input: { name: string; description: string | null }) =>
    (await apiRequest<Category>('/categories', { method: 'POST', body: input })).data,
  update: async (id: number, input: { name: string; description: string | null }) =>
    (await apiRequest<Category>(`/categories/${id}`, { method: 'PUT', body: input })).data,
  remove: async (id: number) => {
    await apiRequest(`/categories/${id}`, { method: 'DELETE' });
  },
};

export interface InventoryListQuery {
  page: number;
  search?: string;
  lowStock?: boolean;
  limit?: number;
}

export interface StockAdjustmentInput {
  quantity?: number;
  reason?: StockReason;
  notes?: string | null;
  reorderLevel?: number;
}

export const inventoryApi = {
  list: (query: InventoryListQuery) => paginated<InventoryItem>('/inventory', { limit: 20, ...query }),
  get: async (productId: number) => (await apiRequest<InventoryDetail>(`/inventory/${productId}`)).data,
  adjust: async (productId: number, input: StockAdjustmentInput) =>
    (await apiRequest<InventoryDetail>(`/inventory/${productId}`, { method: 'PATCH', body: input })).data,
};

export const pricingApi = {
  replace: async (productId: number, tiers: PricingTier[]) =>
    (await apiRequest<{ tiers: PricingTier[] }>(`/pricing/tiers/${productId}`, { method: 'PUT', body: { tiers } })).data,
};

export interface SaleListQuery {
  page: number;
  startDate?: string;
  endDate?: string;
  productId?: number;
}

export const salesApi = {
  async list(query: SaleListQuery) {
    const { data, meta } = await apiRequest<{ sales: Sale[]; totalRevenue: number }>('/sales', {
      query: { limit: 20, ...query },
    });
    return { items: data.sales, totalRevenue: data.totalRevenue, meta: meta! };
  },
  record: async (input: { productId: number; quantity: number; notes: string | null; saleDate?: string }) =>
    (await apiRequest<Sale>('/sales', { method: 'POST', body: input })).data,
};

export const analyticsApi = {
  dashboard: async (days: number) => (await apiRequest<Dashboard>('/analytics/dashboard', { query: { days } })).data,
  revenue: async (period: RevenueSeries['period'], startDate?: string) =>
    (await apiRequest<RevenueSeries>('/analytics/revenue', { query: { period, startDate } })).data,
};

export const usersApi = {
  list: (page: number) => paginated<User>('/users', { page, limit: 50 }),
  create: async (input: { email: string; name: string; role: UserRole; password: string }) =>
    (await apiRequest<User>('/users', { method: 'POST', body: input })).data,
  update: async (id: number, input: { name?: string; role?: UserRole; isActive?: boolean; password?: string }) =>
    (await apiRequest<User>(`/users/${id}`, { method: 'PUT', body: input })).data,
  remove: async (id: number) => {
    await apiRequest(`/users/${id}`, { method: 'DELETE' });
  },
};

export const notificationsApi = {
  async list(page: number, unreadOnly = false) {
    const { data, meta } = await apiRequest<{ notifications: AppNotification[]; unreadCount: number }>(
      '/notifications',
      { query: { page, limit: 20, unreadOnly } },
    );
    return { items: data.notifications, unreadCount: data.unreadCount, meta: meta! };
  },
  markRead: async (id: number) => {
    await apiRequest(`/notifications/${id}/read`, { method: 'PATCH' });
  },
  markAllRead: async () => {
    await apiRequest('/notifications/read-all', { method: 'POST' });
  },
};

export interface ReportRange {
  startDate: string;
  endDate: string;
}

export interface ComparedRange extends ReportRange {
  previousStartDate?: string;
  previousEndDate?: string;
}

export const reportsApi = {
  summary: async (range: ComparedRange) => (await apiRequest<ReportSummary>('/reports/summary', { query: { ...range } })).data,
  team: async (range: ReportRange) => (await apiRequest<TeamRow[]>('/reports/team', { query: { ...range } })).data,
  profit: async (range: ReportRange, groupBy: 'product' | 'category') =>
    (await apiRequest<ProfitRow[]>('/reports/profit', { query: { ...range, groupBy } })).data,
  reorderSuggestions: async () => (await apiRequest<ReorderSuggestion[]>('/reports/reorder-suggestions')).data,
};

export const exportsApi = {
  async download(kind: 'sales' | 'stock' | 'team', range?: ReportRange): Promise<void> {
    // The server names files and writes dates in the admin's own timezone.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { blob, filename } = await apiDownload(`/exports/${kind}.csv`, { ...range, tz });
    saveDownload(blob, filename ?? `4vd-${kind}.csv`);
  },
};

export const activityApi = {
  list: (query: { page: number; userId?: number; action?: string }) =>
    paginated<ActivityEntry>('/activity', { limit: 30, ...query }),
};
