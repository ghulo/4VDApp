import { apiRequest, tokenStore } from './apiClient';
import type {
  Category,
  InventoryDetail,
  InventoryItem,
  Paginated,
  PricingTier,
  Product,
  ProductInput,
  StockReason,
  User,
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
