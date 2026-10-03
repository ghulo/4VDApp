import { apiDownload, apiRequest, saveDownload, tokenStore } from './apiClient';
import type {
  ActivityEntry,
  ApprovalStatus,
  ApprovalSummary,
  AppSettings,
  ReturnCondition,
  ReturnItem,
  StockCount,
  StockCountSummary,
  WriteOff,
  WriteOffReason,
  AppNotification,
  Category,
  Dashboard,
  Insight,
  InventoryDetail,
  InventoryItem,
  Paginated,
  PriceChange,
  PriceSuggestion,
  PricingTier,
  Promotion,
  Business,
  Invite,
  InvitePreview,
  LoginResult,
  Security,
  Session,
  PushSettings,
  PushTopic,
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
  priceHistory: async (id: number) => (await apiRequest<PriceChange[]>(`/products/${id}/price-history`)).data,
  create: async (input: ProductInput) =>
    (await apiRequest<Product>('/products', { method: 'POST', body: input })).data,
  update: async (id: number, input: ProductInput) =>
    (await apiRequest<Product>(`/products/${id}`, { method: 'PUT', body: input })).data,
  remove: async (id: number) => {
    await apiRequest(`/products/${id}`, { method: 'DELETE' });
  },
};

/** Public account pages: invites, passwords, email links, Google. */
export const accountApi = {
  invitePreview: async (token: string) => (await apiRequest<InvitePreview>(`/auth/invites/${token}`)).data,
  acceptInvite: async (token: string, input: { name: string; password: string }) =>
    (await apiRequest<LoginResult>(`/auth/invites/${token}/accept`, { method: 'POST', body: input })).data,
  acceptInviteWithGoogle: async (token: string, credential: string) =>
    (await apiRequest<LoginResult>(`/auth/invites/${token}/google`, { method: 'POST', body: { credential } })).data,
  forgotPassword: async (email: string) =>
    (await apiRequest<null>('/auth/forgot-password', { method: 'POST', body: { email } })),
  resetPassword: async (token: string, password: string) =>
    (await apiRequest<null>('/auth/reset-password', { method: 'POST', body: { token, password } })),
  verifyEmail: async (token: string) => await apiRequest<null>('/auth/verify-email', { method: 'POST', body: { token } }),
  resendVerification: async (email: string) =>
    await apiRequest<null>('/auth/resend-verification', { method: 'POST', body: { email } }),
  confirmEmailChange: async (token: string) =>
    await apiRequest<null>('/auth/confirm-email-change', { method: 'POST', body: { token } }),
  googleStatus: async () => (await apiRequest<{ enabled: boolean; clientId: string | null }>('/auth/google')).data,
  googleSignIn: async (credential: string) =>
    (await apiRequest<LoginResult>('/auth/google', { method: 'POST', body: { credential } })).data,
};

/** The signed-in person's own profile and security. */
export const meApi = {
  updateProfile: async (changes: {
    name?: string;
    phone?: string | null;
    theme?: User['theme'];
    language?: User['language'];
    emailWeeklyReport?: boolean;
  }) =>
    (await apiRequest<User>('/me/profile', { method: 'PUT', body: changes })).data,
  uploadAvatar: async (file: Blob) => (await apiRequest<User>('/me/avatar', { method: 'PUT', file })).data,
  removeAvatar: async () => (await apiRequest<User>('/me/avatar', { method: 'DELETE' })).data,
  changePassword: async (input: { currentPassword?: string; newPassword: string }) =>
    await apiRequest<null>('/me/password', { method: 'POST', body: input }),
  changeEmail: async (input: { password?: string; newEmail: string }) =>
    await apiRequest<null>('/me/email', { method: 'POST', body: input }),
  security: async () => (await apiRequest<Security>('/me/security')).data,
  unlinkGoogle: async () => (await apiRequest<Security>('/me/google', { method: 'DELETE' })).data,
  sessions: async () => (await apiRequest<Session[]>('/me/sessions')).data,
  endSession: async (id: string) => await apiRequest<null>(`/me/sessions/${id}`, { method: 'DELETE' }),
  endOtherSessions: async () => await apiRequest<null>('/me/sessions/log-out-others', { method: 'POST' }),
};

export const businessApi = {
  get: async () => (await apiRequest<Business>('/business')).data,
  update: async (changes: Partial<Omit<Business, 'currency' | 'logoUrl'>>) =>
    (await apiRequest<Business>('/business', { method: 'PUT', body: changes })).data,
  uploadLogo: async (file: Blob) => (await apiRequest<Business>('/business/logo', { method: 'PUT', file })).data,
  removeLogo: async () => (await apiRequest<Business>('/business/logo', { method: 'DELETE' })).data,
};

export const invitesApi = {
  list: async () => (await apiRequest<Invite[]>('/invites')).data,
  create: async (input: { email: string; role: UserRole; language?: User['language'] }) =>
    (await apiRequest<Invite>('/invites', { method: 'POST', body: input })),
  resend: async (id: number) => await apiRequest<Invite>(`/invites/${id}/resend`, { method: 'POST' }),
  cancel: async (id: number) => await apiRequest<null>(`/invites/${id}`, { method: 'DELETE' }),
};

export const promotionsApi = {
  list: async () => (await apiRequest<Promotion[]>('/promotions')).data,
  /** Dates like "2026-10-07"; the end day is included. */
  create: async (input: {
    name: string;
    percentOff: number;
    productId?: number;
    categoryId?: number;
    startsAt: string;
    endsAt: string;
  }) => (await apiRequest<Promotion>('/promotions', { method: 'POST', body: input })).data,
  end: async (id: number) => (await apiRequest<Promotion>(`/promotions/${id}/end`, { method: 'POST' })).data,
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
  update: async (
    id: number,
    input: {
      name?: string;
      role?: UserRole;
      isActive?: boolean;
      password?: string;
      monthlyTarget?: number | null;
      commissionPercent?: number | null;
    },
  ) =>
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

export const assistantApi = {
  status: async () => (await apiRequest<{ enabled: boolean; provider: string | null }>('/assistant')).data,
  ask: async (question: string) =>
    (await apiRequest<{ answer: string }>('/assistant/ask', { method: 'POST', body: { question } })).data,
  suggestPrice: async (productId: number) =>
    (await apiRequest<PriceSuggestion>(`/assistant/price-suggestions/${productId}`, { method: 'POST' })).data,
};

export const pushApi = {
  settings: async () => (await apiRequest<PushSettings>('/notifications/push')).data,
  updatePreferences: async (changes: Partial<Record<PushTopic, boolean>>) =>
    (await apiRequest<PushSettings>('/notifications/push/preferences', { method: 'PUT', body: changes })).data,
  addWebDevice: async (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    (await apiRequest<PushSettings>('/notifications/push/devices', { method: 'POST', body: { kind: 'web', ...subscription } })).data,
  sendTest: async () => {
    await apiRequest('/notifications/push/test', { method: 'POST' });
  },
  removeDevice: async (token: string) =>
    (await apiRequest<PushSettings>('/notifications/push/devices', { method: 'DELETE', body: { token } })).data,
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
  insights: async () => (await apiRequest<Insight[]>('/reports/insights')).data,
  dailySummary: async () => (await apiRequest<{ title: string; message: string; salesLine: string }>('/reports/daily-summary')).data,
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

export const settingsApi = {
  get: async () => (await apiRequest<AppSettings>('/settings')).data,
  update: async (input: Partial<AppSettings>) => (await apiRequest<AppSettings>('/settings', { method: 'PUT', body: input })).data,
};

export const returnsApi = {
  list: async (status?: ApprovalStatus) => (await apiRequest<ReturnItem[]>('/returns', { query: { status } })).data,
  request: async (
    saleId: number,
    input: { quantity: number; condition: ReturnCondition; refundAmount?: number; notes: string | null },
  ) => (await apiRequest<ReturnItem>(`/sales/${saleId}/returns`, { method: 'POST', body: input })).data,
  approve: async (id: number) => (await apiRequest<ReturnItem>(`/returns/${id}/approve`, { method: 'POST' })).data,
  reject: async (id: number, note: string) =>
    (await apiRequest<ReturnItem>(`/returns/${id}/reject`, { method: 'POST', body: { note } })).data,
};

export const writeOffsApi = {
  list: async (status?: ApprovalStatus) => (await apiRequest<WriteOff[]>('/write-offs', { query: { status } })).data,
  request: async (input: { productId: number; quantity: number; reason: WriteOffReason; notes: string | null }) =>
    (await apiRequest<WriteOff>('/write-offs', { method: 'POST', body: input })).data,
  approve: async (id: number) => (await apiRequest<WriteOff>(`/write-offs/${id}/approve`, { method: 'POST' })).data,
  reject: async (id: number, note: string) =>
    (await apiRequest<WriteOff>(`/write-offs/${id}/reject`, { method: 'POST', body: { note } })).data,
};

export const stockCountsApi = {
  list: async () => (await apiRequest<StockCountSummary[]>('/stock-counts')).data,
  get: async (id: number) => (await apiRequest<StockCount>(`/stock-counts/${id}`)).data,
  start: async (categoryId: number | null) =>
    (await apiRequest<StockCount>('/stock-counts', { method: 'POST', body: { categoryId } })).data,
  cancel: async (id: number) => (await apiRequest<StockCount>(`/stock-counts/${id}/cancel`, { method: 'POST' })).data,
  approveLine: async (id: number, productId: number) =>
    (await apiRequest<StockCount>(`/stock-counts/${id}/lines/${productId}/approve`, { method: 'POST' })).data,
  rejectLine: async (id: number, productId: number, note: string) =>
    (await apiRequest<StockCount>(`/stock-counts/${id}/lines/${productId}/reject`, { method: 'POST', body: { note } })).data,
  approveAll: async (id: number) =>
    (
      await apiRequest<{ approved: number; failed: Array<{ productId: number; productName: string; message: string }> }>(
        `/stock-counts/${id}/approve-all`,
        { method: 'POST' },
      )
    ).data,
};

export const approvalsApi = {
  summary: async () => (await apiRequest<ApprovalSummary>('/approvals/summary')).data,
};
