import { apiRequest, tokenStore } from './apiClient';
import type { Category, MySales, PaginationMeta, Product, Sale, User } from './types';

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

export const reportsApi = {
  mySales: async (startDate: string, endDate: string) =>
    (await apiRequest<MySales>('/reports/my-sales', { query: { startDate, endDate } })).data,
};
