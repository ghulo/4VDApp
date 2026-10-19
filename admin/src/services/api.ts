import { apiDownload, apiRequest, saveDownload, tokenStore } from './apiClient';
import type { Language } from '../i18n/language';
import type {
  PartnerDetails,
  RecordSource,
  Offer,
  OfferDetail,
  TrefinStockDocument,
  TrefinStockDocumentDetail,
  TestDelivery,
  Thread,
  ThreadSubject,
  VatMonth,
  VatYearRow,
  WithholdingRow,
  TrefinCompare,
  BillInput,
  BillFormInput,
  BillPreview,
  CreditInput,
  WithholdingType,
  FullReport,
  PayablesSummary,
  ReportKind,
  ReportSettings,
  SupplierBill,
  SupplierPaymentMethod,
  DocumentKind,
  DocumentRef,
  SalesDocument,
  SalesDocumentDetail,
  ActivityEntry,
  ApprovalStatus,
  AppSettings,
  ReturnCondition,
  ReturnItem,
  StockCount,
  StockCountListItem,
  WriteOff,
  WriteOffReason,
  AppNotification,
  Category,
  DuplicatePair,
  Dashboard,
  Insight,
  InventoryDetail,
  InventoryItem,
  Paginated,
  PriceChange,
  PriceSuggestion,
  Promotion,
  PromotionPreviewLine,
  PromotionResults,
  PromotionSales,
  Carwash,
  CarwashDay,
  CarwashTotals,
  CarwashTotalsByCarwash,
  LaunchStep,
  WipeReport,
  CashCount,
  CashPlace,
  CashPlaceToday,
  Expense,
  ExpenseCategory,
  ExpensePlace,
  ExpenseTotals,
  RecurringExpense,
  Customer,
  CustomerDetail,
  CustomerKind,
  Supplier,
  PurchaseOrder,
  ExpiryDate,
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
  TeamMember,
  User,
  UserRole,
  ShopDay,
  Checkout,
  CheckoutDayTotal,
  SalesPatterns,
  Attention,
  AssistantChat,
  AssistantThread,
  BillScan,
  HistoryEntity,
  RestorePlan,
  ProductRequest,
  ConfirmScanInput,
  WaitingScan,
  AccountCard,
  AccountInput,
  AccountLinkKey,
  BooksPeriod,
  BankLine,
  BankLineStatus,
  BankRule,
  BankRuleInput,
  BankStatement,
  LineAction,
  MoneyPlace,
  MoveInput,
  PayBillsInput,
  PlaceBook,
  PlaceChanges,
  PlaceInput,
  ReceiveInput,
  StatementLayout,
  StatementUpload,
  BooksSettings,
  EntrySource,
  OpeningBalances,
  TYPED_OPENING_SOURCES,
  LedgerAccount,
  LedgerEntry,
  ManualEntryInput,
  TrialBalance,
  CounterEvent,
  CounterEventInput,
  CounterPerson,
  CounterReceipt,
  CounterSettings,
  CounterToday,
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
  byBarcode: async (barcode: string) => (await apiRequest<Product>(`/products/barcode/${encodeURIComponent(barcode)}`)).data,
  setBarcode: async (id: number, barcode: string | null) =>
    (await apiRequest<Product>(`/products/${id}/barcode`, { method: 'PUT', body: { barcode } })).data,
  addBarcode: async (id: number, barcode: string) =>
    (await apiRequest<Product>(`/products/${id}/barcodes`, { method: 'POST', body: { barcode } })).data,
  removeBarcode: async (id: number, barcode: string) =>
    (await apiRequest<Product>(`/products/${id}/barcodes/${encodeURIComponent(barcode)}`, { method: 'DELETE' })).data,
  createBarcode: async (id: number) => (await apiRequest<Product>(`/products/${id}/barcode`, { method: 'POST' })).data,
  uploadImage: async (id: number, file: Blob) =>
    (await apiRequest<Product>(`/products/${id}/image`, { method: 'PUT', file })).data,
};

/** Public account pages: invites, passwords, email links, Google. */
export const accountApi = {
  invitePreview: async (token: string) => (await apiRequest<InvitePreview>(`/auth/invites/${token}`)).data,
  acceptInvite: async (token: string, input: { name: string; password: string; language?: User['language'] }) =>
    (await apiRequest<LoginResult>(`/auth/invites/${token}/accept`, { method: 'POST', body: input })).data,
  acceptInviteWithGoogle: async (token: string, credential: string, language?: User['language']) =>
    (await apiRequest<LoginResult>(`/auth/invites/${token}/google`, { method: 'POST', body: { credential, language } })).data,
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
  summary: async () => (await apiRequest<PromotionSales>('/promotions/summary')).data,
  results: async (id: number) => (await apiRequest<PromotionResults>(`/promotions/${id}/results`)).data,
  preview: async (input: { percentOff: number; productId?: number; categoryId?: number }) =>
    (await apiRequest<PromotionPreviewLine[]>('/promotions/preview', { method: 'POST', body: input })).data,
};

export const duplicatesApi = {
  list: async (status: 'open' | 'done') => (await apiRequest<DuplicatePair[]>(`/duplicates?status=${status}`)).data,
  merge: async (id: number, input: { keepId: number }) => {
    await apiRequest(`/duplicates/${id}/merge`, { method: 'POST', body: input });
  },
  keepBoth: async (id: number) => {
    await apiRequest(`/duplicates/${id}/keep-both`, { method: 'POST' });
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

export interface SaleListQuery {
  page: number;
  startDate?: string;
  endDate?: string;
  productId?: number;
  soldBy?: number;
  /** Checkouts only: a product name or invoice number. */
  search?: string;
  source?: RecordSource;
}

export interface DocumentListQuery {
  page: number;
  kind?: DocumentKind;
  search?: string;
  customerId?: number;
  startDate?: string;
  endDate?: string;
  source?: RecordSource;
}

export const offersApi = {
  list: (query: { page: number; search?: string }) => paginated<Offer>('/offers', { limit: 25, ...query }),
  get: async (id: number) => (await apiRequest<OfferDetail>(`/offers/${id}`)).data,
};

export const documentsApi = {
  async list(query: DocumentListQuery) {
    const { data, meta } = await apiRequest<SalesDocument[]>('/documents', { query: { limit: 20, ...query } });
    return { items: data, meta: meta! };
  },
  get: async (id: number) => (await apiRequest<SalesDocumentDetail>(`/documents/${id}`)).data,
  /** The printable A4 page, in the reader's language unless another is asked for. */
  printPage: async (id: number, language?: Language) => (await apiDownload(`/documents/${id}/print`, { language })).blob.text(),
  setFiscalReceipt: async (id: number, fiscalReceiptNo: string | null) =>
    (await apiRequest<SalesDocumentDetail>(`/documents/${id}/fiscal-receipt`, { method: 'PUT', body: { fiscalReceiptNo } })).data,
};

export const salesApi = {
  async list(query: SaleListQuery) {
    const { data, meta } = await apiRequest<{ sales: Sale[]; totalRevenue: number }>('/sales', {
      query: { limit: 20, ...query },
    });
    return { items: data.sales, totalRevenue: data.totalRevenue, meta: meta! };
  },
  /** Sales history by checkout: one row per invoice, with its lines. */
  async checkouts(query: SaleListQuery) {
    const { data, meta } = await apiRequest<{ checkouts: Checkout[]; totalRevenue: number; days: CheckoutDayTotal[] }>('/sales/checkouts', {
      query: { limit: 20, ...query },
    });
    return { items: data.checkouts, totalRevenue: data.totalRevenue, days: data.days, meta: meta! };
  },
  recordBasket: async (input: {
    items: Array<{ productId: number; quantity: number; discountPercent?: number }>;
    notes: string | null;
    customerId?: number;
    paidNow?: boolean;
    /** At the Counter: card money goes to the bank, not the drawer. */
    paidBy?: 'cash' | 'card';
  }) =>
    (await apiRequest<{ sales: Sale[]; total: number; invoice: DocumentRef }>('/sales/basket', { method: 'POST', body: input })).data,
  record: async (input: { productId: number; quantity: number; notes: string | null; saleDate?: string; customerId?: number }) =>
    (await apiRequest<Sale>('/sales', { method: 'POST', body: input })).data,
};

export const counterApi = {
  settings: async () => (await apiRequest<CounterSettings>('/counter/settings')).data,
  updateSettings: async (input: CounterSettings) => (await apiRequest<CounterSettings>('/counter/settings', { method: 'PUT', body: input })).data,
  record: async (events: CounterEventInput[]) => {
    await apiRequest('/counter/events', { method: 'POST', body: { events } });
  },
  today: async () => (await apiRequest<CounterToday>('/counter/today')).data,
  /** Today's receipts, or the one with this number. */
  receipts: async (number?: string) => (await apiRequest<CounterReceipt[]>('/counter/receipts', { query: { number } })).data,
  people: async (period: { from: string; to: string }) => (await apiRequest<CounterPerson[]>('/counter/people', { query: period })).data,
  events: async (period: { from: string; to: string; userId?: number; source?: RecordSource }) => (await apiRequest<CounterEvent[]>('/counter/events', { query: period })).data,
  /** Every product on sale, a hundred at a time, for the Counter's shelf. */
  async products(): Promise<Product[]> {
    const first = await productsApi.list({ page: 1, limit: 100 });
    const pages = Math.ceil(first.meta.total / 100);
    const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, index) => productsApi.list({ page: index + 2, limit: 100 })));
    return [first, ...rest].flatMap((page) => page.items).filter((product) => product.isActive);
  },
};

export const analyticsApi = {
  dashboard: async (days: number) => (await apiRequest<Dashboard>('/analytics/dashboard', { query: { days } })).data,
  revenue: async (period: RevenueSeries['period'], startDate?: string, endDate?: string) =>
    (await apiRequest<RevenueSeries>('/analytics/revenue', { query: { period, startDate, endDate } })).data,
};

export const usersApi = {
  list: (page: number) => paginated<TeamMember>('/users', { page, limit: 50 }),
  /** Someone's devices, for their page. */
  sessions: async (id: number) => (await apiRequest<Session[]>(`/users/${id}/sessions`)).data,
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

export const attentionApi = {
  get: async () => (await apiRequest<Attention>('/attention')).data,
};

export const notificationsApi = {
  async list(page: number, unreadOnly = false, types?: string) {
    const { data, meta } = await apiRequest<{ notifications: AppNotification[]; unreadCount: number }>(
      '/notifications',
      { query: { page, limit: 20, unreadOnly, types } },
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
  chats: async () => (await apiRequest<AssistantChat[]>('/assistant/chats')).data,
  chat: async (id: number) => (await apiRequest<AssistantThread>(`/assistant/chats/${id}`)).data,
  /** Asks in a chat, or starts a new one without `chatId`. Returns the chat and the new question and answer. */
  ask: async (question: string, chatId?: number) =>
    (await apiRequest<AssistantThread>('/assistant/chats/messages', { method: 'POST', body: { question, chatId } })).data,
  deleteChat: async (id: number) => {
    await apiRequest(`/assistant/chats/${id}`, { method: 'DELETE' });
  },
  suggestPrice: async (productId: number) =>
    (await apiRequest<PriceSuggestion>(`/assistant/price-suggestions/${productId}`, { method: 'POST' })).data,
};

export const pushApi = {
  settings: async () => (await apiRequest<PushSettings>('/notifications/push')).data,
  updatePreferences: async (changes: Partial<Record<PushTopic, boolean>>) =>
    (await apiRequest<PushSettings>('/notifications/push/preferences', { method: 'PUT', body: changes })).data,
  addWebDevice: async (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    (await apiRequest<PushSettings>('/notifications/push/devices', { method: 'POST', body: { kind: 'web', app: 'dashboard', ...subscription } })).data,
  /** Sends a test alert now and says, per device, whether it got through. */
  sendTest: async () => (await apiRequest<TestDelivery[]>('/notifications/push/test', { method: 'POST' })).data,
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

export const billsApi = {
  list: async (query: { status?: 'open' | 'paid' | 'void'; supplierId?: number; source?: RecordSource } = {}) =>
    (await apiRequest<SupplierBill[]>('/bills', { query })).data,
  summary: async () => (await apiRequest<PayablesSummary>('/bills/summary')).data,
  get: async (id: number) => (await apiRequest<SupplierBill>(`/bills/${id}`)).data,
  create: async (input: BillFormInput | (BillInput & { supplierId: number; orderId?: number | null })) =>
    (await apiRequest<SupplierBill>('/bills', { method: 'POST', body: input })).data,
  /** What a bill will do before it is saved: stock, costs, VAT, what is owed, and costs that went up. */
  preview: async (input: BillFormInput) => (await apiRequest<BillPreview>('/bills/preview', { method: 'POST', body: input })).data,
  /** A return or credit against a bill. */
  credit: async (id: number, input: CreditInput) => (await apiRequest<SupplierBill>(`/bills/${id}/credit`, { method: 'POST', body: input })).data,
  update: async (id: number, input: BillInput) => (await apiRequest<SupplierBill>(`/bills/${id}`, { method: 'PUT', body: input })).data,
  /** From a place (placeId), or only how it was paid (method) for that kind's usual place. */
  pay: async (id: number, input: { amount: number; paidOn: string; placeId?: number; method?: SupplierPaymentMethod; note: string | null }) =>
    (await apiRequest<SupplierBill>(`/bills/${id}/payments`, { method: 'POST', body: input })).data,
  voidPayment: async (id: number, paymentId: number) =>
    (await apiRequest<SupplierBill>(`/bills/${id}/payments/${paymentId}/void`, { method: 'POST' })).data,
  void: async (id: number, note: string) => (await apiRequest<SupplierBill>(`/bills/${id}/void`, { method: 'POST', body: { note } })).data,
  setPhoto: async (id: number, photo: Blob) => (await apiRequest<SupplierBill>(`/bills/${id}/photo`, { method: 'PUT', file: photo })).data,
  removePhoto: async (id: number) => (await apiRequest<SupplierBill>(`/bills/${id}/photo`, { method: 'DELETE' })).data,
};

export const billScansApi = {
  /** Pages as base64; photos are shrunk first, PDFs go whole. */
  scan: async (pages: Array<{ mime: string; data: string }>) =>
    (await apiRequest<{ id: number; supplierName: string | null; number: string | null; lines: number }>('/bill-scans', { method: 'POST', body: { pages } })).data,
  waiting: async () => (await apiRequest<WaitingScan[]>('/bill-scans')).data,
  get: async (id: number, supplierId?: number) => (await apiRequest<BillScan>(`/bill-scans/${id}`, { query: { supplierId } })).data,
  confirm: async (id: number, input: ConfirmScanInput) =>
    (await apiRequest<{ billId: number; orderId: number }>(`/bill-scans/${id}/confirm`, { method: 'POST', body: input })).data,
  discard: async (id: number) => apiRequest<null>(`/bill-scans/${id}/discard`, { method: 'POST' }),
  /** Developer only: puts back everything the confirm did and makes the scan wait again. */
  reopen: async (id: number) => apiRequest<null>(`/bill-scans/${id}/reopen`, { method: 'POST' }),
};

export const fullReportsApi = {
  get: async (kind: ReportKind, from?: string) => (await apiRequest<FullReport>('/reports/full', { query: { kind, from } })).data,
  settings: async () => (await apiRequest<ReportSettings>('/reports/settings')).data,
  saveSettings: async (settings: ReportSettings) => (await apiRequest<ReportSettings>('/reports/settings', { method: 'PUT', body: settings })).data,
  sendTest: async (kind: ReportKind) => apiRequest<null>('/reports/send-test', { method: 'POST', body: { kind } }),
};

export const reportsApi = {
  summary: async (range: ComparedRange) => (await apiRequest<ReportSummary>('/reports/summary', { query: { ...range } })).data,
  team: async (range: ReportRange) => (await apiRequest<TeamRow[]>('/reports/team', { query: { ...range } })).data,
  /** By product or category; one seller's sales only with `userId`. */
  profit: async (range: ReportRange, groupBy: 'product' | 'category', userId?: number) =>
    (await apiRequest<ProfitRow[]>('/reports/profit', { query: { ...range, groupBy, userId } })).data,
  /** Sales per day, hour and weekday; one seller's only with `userId`. */
  patterns: async (range: ReportRange, userId?: number) =>
    (await apiRequest<SalesPatterns>('/reports/patterns', { query: { ...range, userId } })).data,
  reorderSuggestions: async () => (await apiRequest<ReorderSuggestion[]>('/reports/reorder-suggestions')).data,
  insights: async () => (await apiRequest<Insight[]>('/reports/insights')).data,
  dailySummary: async () => (await apiRequest<{ title: string; message: string; salesLine: string }>('/reports/daily-summary')).data,
};

export const carwashApi = {
  /** One carwash, or all of them when `carwashId` is left out; `byCarwash` always covers every carwash. */
  list: async (range: ReportRange, carwashId?: number) =>
    (
      await apiRequest<{ days: CarwashDay[]; totals: CarwashTotals; byCarwash: CarwashTotalsByCarwash[] }>('/carwash', {
        query: { ...range, carwashId },
      })
    ).data,
  /** `day` like "2026-10-04"; entering a day again replaces it. */
  save: async (carwashId: number, day: string, takings: { carwash: number; change: number }) => {
    await apiRequest(`/carwash/${day}`, { method: 'PUT', body: { carwashId, ...takings } });
  },
  remove: async (carwashId: number, day: string) => {
    await apiRequest(`/carwash/${day}`, { method: 'DELETE', query: { carwashId } });
  },
  /** The open carwashes, plus the archived ones when asked (managers only). */
  places: async (includeArchived = false) =>
    (await apiRequest<Carwash[]>('/carwash/places', { query: { includeArchived } })).data,
  addPlace: async (input: { name: string; cashFloat: number }) =>
    (await apiRequest<Carwash>('/carwash/places', { method: 'POST', body: input })).data,
  updatePlace: async (id: number, changes: { name?: string; cashFloat?: number; archived?: boolean }) =>
    (await apiRequest<Carwash>(`/carwash/places/${id}`, { method: 'PATCH', body: changes })).data,
};

export const cashApi = {
  list: async (range: ReportRange) => (await apiRequest<CashCount[]>('/cash-counts', { query: { ...range } })).data,
  today: async () => (await apiRequest<CashPlaceToday[]>('/cash-counts/today')).data,
  /** Someone looked at a count's difference, so it leaves the To do list. */
  check: async (id: number) => {
    await apiRequest(`/cash-counts/${id}/check`, { method: 'POST' });
  },
  /** Overseers get the result back; staff get null (they count blind). */
  count: async (input: { place: CashPlace; carwashId?: number; counted: number; float?: number; note: string | null }) =>
    (await apiRequest<CashCount | null>('/cash-counts', { method: 'POST', body: input })).data,
};

export const dayApi = {
  /** One shop day ("2026-10-10"); today when left out. */
  get: async (date?: string) => (await apiRequest<ShopDay>('/day', { query: { date } })).data,
  /** Managers say a day had no expenses (or take it back). */
  setNoExpenses: async (none: boolean, date?: string) =>
    (await apiRequest<ShopDay>('/day/no-expenses', { method: 'PUT', body: { none, date } })).data,
};

export const expensesApi = {
  list: async (range: ReportRange) =>
    (await apiRequest<{ expenses: Expense[]; totals: ExpenseTotals }>('/expenses', { query: { ...range } })).data,
  add: async (input: {
    day: string;
    amount: number;
    category: ExpenseCategory;
    place: ExpensePlace;
    carwashId?: number;
    /** Who was paid, when it was a supplier. */
    supplierId?: number | null;
    note: string | null;
    repeatMonthly: boolean;
  }) =>
    (await apiRequest<Expense>('/expenses', { method: 'POST', body: input })).data,
  remove: async (id: number) => {
    await apiRequest(`/expenses/${id}`, { method: 'DELETE' });
  },
  recurring: async () => (await apiRequest<RecurringExpense[]>('/expenses/recurring')).data,
  stopRepeating: async (id: number) => {
    await apiRequest(`/expenses/recurring/${id}/stop`, { method: 'POST' });
  },
};

export interface CustomerInput extends Partial<PartnerDetails> {
  name: string;
  kind: CustomerKind;
  nui: string | null;
  phone: string | null;
  note: string | null;
  creditLimit?: number | null;
  discountPercent?: number | null;
}

/** The partner details left out keep what is stored. */
export interface SupplierInput extends Partial<PartnerDetails> {
  name: string;
  /** Null for a business abroad, which has no Kosovo NUI. */
  nui: string | null;
  phone: string | null;
  email: string | null;
  abroad: boolean;
  withholdingType: WithholdingType | null;
}

export const customersApi = {
  list: async () => (await apiRequest<Customer[]>('/customers')).data,
  detail: async (id: number) => (await apiRequest<CustomerDetail>(`/customers/${id}`)).data,
  create: async (input: CustomerInput) => (await apiRequest<Customer>('/customers', { method: 'POST', body: input })).data,
  update: async (id: number, input: CustomerInput) =>
    (await apiRequest<Customer>(`/customers/${id}`, { method: 'PUT', body: input })).data,
  pay: async (id: number, input: ReceiveInput) => (await apiRequest<CustomerDetail>(`/customers/${id}/payments`, { method: 'POST', body: input })).data,
  archive: async (id: number) => {
    await apiRequest(`/customers/${id}/archive`, { method: 'POST' });
  },
};

export const suppliersApi = {
  list: async () => (await apiRequest<Supplier[]>('/suppliers')).data,
  add: async (input: SupplierInput) => (await apiRequest<Supplier>('/suppliers', { method: 'POST', body: input })).data,
  update: async (id: number, input: SupplierInput) =>
    (await apiRequest<Supplier>(`/suppliers/${id}`, { method: 'PUT', body: input })).data,
  remove: async (id: number) => {
    await apiRequest(`/suppliers/${id}`, { method: 'DELETE' });
  },
};

export const ordersApi = {
  list: async () => (await apiRequest<PurchaseOrder[]>('/orders')).data,
  get: async (id: number) => (await apiRequest<PurchaseOrder>(`/orders/${id}`)).data,
  usualSuppliers: async () => (await apiRequest<Record<number, number>>('/orders/usual-suppliers')).data,
  create: async (input: { supplierId: number; note: string | null; lines: Array<{ productId: number; quantity: number; unitCost: number | null }> }) =>
    (await apiRequest<PurchaseOrder>('/orders', { method: 'POST', body: input })).data,
  receive: async (
    id: number,
    input: {
      lines: Array<{ lineId: number; receivedQuantity: number; unitCost: number | null; expiresOn: string | null }>;
      updateCostPrices: boolean;
      bill?: BillInput;
    },
  ) =>
    (await apiRequest<PurchaseOrder>(`/orders/${id}/receive`, { method: 'POST', body: input })).data,
  cancel: async (id: number) => (await apiRequest<PurchaseOrder>(`/orders/${id}/cancel`, { method: 'POST' })).data,
};

export const expiryApi = {
  forProduct: async (productId: number) => (await apiRequest<ExpiryDate[]>('/expiry', { query: { productId } })).data,
  add: async (input: { productId: number; quantity: number; expiresOn: string; note: string | null }) =>
    (await apiRequest<ExpiryDate>('/expiry', { method: 'POST', body: input })).data,
  clear: async (id: number) => {
    await apiRequest(`/expiry/${id}/clear`, { method: 'POST' });
  },
};

export const exportsApi = {
  /** A formatted Excel workbook, or plain CSV for importing elsewhere. */
  async download(kind: 'sales' | 'stock' | 'team' | 'money' | 'expenses', format: 'xlsx' | 'csv', range?: ReportRange): Promise<void> {
    // The server names files and writes dates in the admin's own timezone.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { blob, filename } = await apiDownload(`/exports/${kind}.${format}`, { ...range, tz });
    saveDownload(blob, filename ?? `4vd-${kind}.${format}`);
  },
};

export const activityApi = {
  list: (query: { page: number; userId?: number; action?: string; exclude?: string; search?: string; limit?: number; source?: RecordSource }) =>
    paginated<ActivityEntry>('/activity', { limit: 30, ...query }),
  undo: async (id: number, note: string) =>
    (await apiRequest<ActivityEntry>(`/activity/${id}/undo`, { method: 'POST', body: note ? { note } : {} })).data,
  restore: async (id: number) => (await apiRequest<ActivityEntry>(`/activity/${id}/restore`, { method: 'POST' })).data,
  /** Everything that happened to one record, oldest first (an invoice includes its sales, returns and credit notes). */
  history: async (entityType: HistoryEntity, entityId: number) =>
    (await apiRequest<ActivityEntry[]>('/activity/history', { query: { entityType, entityId } })).data,
  /** Developer only: what putting the record back to this entry would change. */
  restorePlan: async (id: number) => (await apiRequest<RestorePlan>(`/activity/${id}/restore-point`)).data,
  /** Developer only: put the record back; refused when it changed after `latestEntryId`. */
  restoreTo: async (id: number, latestEntryId: number) =>
    (await apiRequest<RestorePlan>(`/activity/${id}/restore-point`, { method: 'POST', body: { latestEntryId } })).data,
};

export const settingsApi = {
  get: async () => (await apiRequest<AppSettings>('/settings')).data,
  update: async (input: Partial<AppSettings>) => (await apiRequest<AppSettings>('/settings', { method: 'PUT', body: input })).data,
  /** Developer only. */
  launchChecklist: async () => (await apiRequest<LaunchStep[]>('/settings/launch-checklist')).data,
  /** Emails the signed-in developer; `sent` is false (with a `reason`) when real emails don't work yet. */
  testEmail: async () => (await apiRequest<{ to: string; sent: boolean; reason: string | null }>('/settings/test-email', { method: 'POST' })).data,
  wipePreview: async () => (await apiRequest<WipeReport>('/settings/wipe-preview')).data,
  /** Deletes all test data; `confirm` has to be the typed phrase. */
  wipe: async (confirm: string) => (await apiRequest<WipeReport>('/settings/wipe', { method: 'POST', body: { confirm } })).data,
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

export const productRequestsApi = {
  pending: async () => (await apiRequest<ProductRequest[]>('/product-requests')).data,
  /** Corrections left out stay as asked. */
  approve: async (id: number, edits: { categoryId?: number; price?: number }) =>
    (await apiRequest<ProductRequest>(`/product-requests/${id}/approve`, { method: 'POST', body: edits })).data,
  reject: async (id: number, note: string) =>
    (await apiRequest<ProductRequest>(`/product-requests/${id}/reject`, { method: 'POST', body: { note } })).data,
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
  list: async () => (await apiRequest<StockCountListItem[]>('/stock-counts')).data,
  get: async (id: number) => (await apiRequest<StockCount>(`/stock-counts/${id}`)).data,
  /** TREFIN's starting stocks, corrections and counts. */
  trefinList: async () => (await apiRequest<TrefinStockDocument[]>('/stock-counts/trefin')).data,
  trefinGet: async (id: number) => (await apiRequest<TrefinStockDocumentDetail>(`/stock-counts/trefin/${id}`)).data,
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

export const booksApi = {
  accounts: async () => (await apiRequest<LedgerAccount[]>('/books/accounts')).data,
  addAccount: async (input: AccountInput) => (await apiRequest<LedgerAccount>('/books/accounts', { method: 'POST', body: input })).data,
  updateAccount: async (id: number, input: Partial<AccountInput & { archived: boolean }>) =>
    (await apiRequest<LedgerAccount>(`/books/accounts/${id}`, { method: 'PATCH', body: input })).data,
  card: async (id: number, period: BooksPeriod, corrections: boolean, source?: RecordSource) =>
    (await apiRequest<AccountCard>(`/books/accounts/${id}/card`, { query: { ...period, corrections, source } })).data,
  trialBalance: async (period: BooksPeriod) => (await apiRequest<TrialBalance>('/books/trial-balance', { query: { ...period } })).data,
  journal: (query: BooksPeriod & { page: number; search?: string; corrections: boolean; source?: RecordSource }) =>
    paginated<LedgerEntry>('/books/journal', { limit: 25, ...query }),
  /** An entry by its number; below zero, an entry of TREFIN's journal. */
  entry: async (id: number) => (await apiRequest<LedgerEntry>(id < 0 ? `/books/trefin-entries/${-id}` : `/books/entries/${id}`)).data,
  /** The entries one document wrote, oldest first. */
  entriesFor: async (source: EntrySource, id: number) => (await apiRequest<LedgerEntry[]>('/books/entries', { query: { source, id } })).data,
  addEntry: async (input: ManualEntryInput) => (await apiRequest<LedgerEntry>('/books/entries', { method: 'POST', body: input })).data,
  reverseEntry: async (id: number) => (await apiRequest<LedgerEntry>(`/books/entries/${id}/reverse`, { method: 'POST' })).data,
  settings: async () => (await apiRequest<BooksSettings>('/books/settings')).data,
  updateSettings: async (input: { startDay?: string; links?: Partial<Record<AccountLinkKey, number>> }) =>
    (await apiRequest<BooksSettings>('/books/settings', { method: 'PUT', body: input })).data,
  opening: async () => (await apiRequest<OpeningBalances>('/books/opening')).data,
  updateOpeningLine: async (id: number, input: { amount?: number; source?: (typeof TYPED_OPENING_SOURCES)[number]; note?: string | null }) =>
    (await apiRequest<OpeningBalances>(`/books/opening/lines/${id}`, { method: 'PATCH', body: input })).data,
  addOpeningLine: async (input: { accountId: number; amount: number; note?: string | null }) =>
    (await apiRequest<OpeningBalances>('/books/opening/lines', { method: 'POST', body: input })).data,
  removeOpeningLine: async (id: number) => (await apiRequest<OpeningBalances>(`/books/opening/lines/${id}`, { method: 'DELETE' })).data,
  confirmOpening: async (ids: number[], confirmed: boolean) =>
    (await apiRequest<OpeningBalances>('/books/opening/confirm', { method: 'POST', body: { ids, confirmed } })).data,
  postOpening: async () => (await apiRequest<OpeningBalances>('/books/opening/post', { method: 'POST' })).data,
  takeBackOpening: async (reason: string) => (await apiRequest<OpeningBalances>('/books/opening/take-back', { method: 'POST', body: { reason } })).data,
  /** An Excel file: the trial balance, journal, general ledger, or one account's card. */
  async download(what: 'trial-balance' | 'journal' | 'ledger' | { account: number }, period: BooksPeriod, lang: 'sq' | 'en'): Promise<void> {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const path = typeof what === 'string' ? `/books/${what}.xlsx` : `/books/accounts/${what.account}/card.xlsx`;
    const { blob, filename } = await apiDownload(path, { ...period, lang, tz });
    saveDownload(blob, filename ?? '4vd-books.xlsx');
  },
};

/** Where money is kept, the moves between places, and bank statements. */
export const moneyApi = {
  places: async () => (await apiRequest<MoneyPlace[]>('/money/places')).data,
  addPlace: async (input: PlaceInput) => (await apiRequest<MoneyPlace>('/money/places', { method: 'POST', body: input })).data,
  updatePlace: async (id: number, input: PlaceChanges) => (await apiRequest<MoneyPlace>(`/money/places/${id}`, { method: 'PATCH', body: input })).data,
  book: async (id: number, period: BooksPeriod) => (await apiRequest<PlaceBook>(`/money/places/${id}/book`, { query: { ...period } })).data,
  async downloadBook(id: number, period: BooksPeriod, lang: 'sq' | 'en'): Promise<void> {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { blob, filename } = await apiDownload(`/money/places/${id}/book.xlsx`, { ...period, lang, tz });
    saveDownload(blob, filename ?? '4vd-money.xlsx');
  },
  move: async (input: MoveInput) => (await apiRequest<{ id: number }>('/money/moves', { method: 'POST', body: input })).data,
  voidMove: async (id: number) => {
    await apiRequest(`/money/moves/${id}/void`, { method: 'POST' });
  },
  payBills: async (input: PayBillsInput) => (await apiRequest<{ groupId: number }>('/money/pay-bills', { method: 'POST', body: input })).data,
  statements: async (placeId: number) => (await apiRequest<BankStatement[]>(`/money/places/${placeId}/statements`)).data,
  upload: async (placeId: number, input: { fileName: string; data: string; layout?: StatementLayout }) =>
    (await apiRequest<StatementUpload>(`/money/places/${placeId}/statements`, { method: 'POST', body: input })).data,
  lines: async (placeId: number, status: BankLineStatus | 'all') => (await apiRequest<BankLine[]>(`/money/places/${placeId}/lines`, { query: { status } })).data,
  confirm: async (lineId: number, input: { action: LineAction; rule?: { contains: string } | null; ruleId?: number | null }) => {
    await apiRequest(`/money/lines/${lineId}/confirm`, { method: 'POST', body: input });
  },
  confirmSure: async (placeId: number) => (await apiRequest<{ confirmed: number; failed: number }>(`/money/places/${placeId}/confirm-sure`, { method: 'POST' })).data,
  undo: async (lineId: number) => {
    await apiRequest(`/money/lines/${lineId}/undo`, { method: 'POST' });
  },
  skip: async (lineId: number, skipped: boolean) => {
    await apiRequest(`/money/lines/${lineId}/skip`, { method: 'POST', body: { skipped } });
  },
  rules: async () => (await apiRequest<BankRule[]>('/money/rules')).data,
  addRule: async (input: BankRuleInput) => (await apiRequest<BankRule>('/money/rules', { method: 'POST', body: input })).data,
  updateRule: async (id: number, input: BankRuleInput) => (await apiRequest<BankRule>(`/money/rules/${id}`, { method: 'PUT', body: input })).data,
  removeRule: async (id: number) => {
    await apiRequest(`/money/rules/${id}`, { method: 'DELETE' });
  },
};

export type BookKind = 'sales' | 'purchases';

export const vatApi = {
  filed: async () => (await apiRequest<string[]>('/vat/filed')).data,
  month: async (month: string) => (await apiRequest<VatMonth>(`/vat/${month}`)).data,
  year: async (year: number) => (await apiRequest<VatYearRow[]>(`/vat/year/${year}`)).data,
  /** Box 70 (refund asked for), and box 68 for the first month. */
  saveTyped: async (month: string, input: { refund?: number; carriedIn?: number | null }) =>
    (await apiRequest<VatMonth>(`/vat/${month}`, { method: 'PUT', body: input })).data,
  file: async (month: string) => (await apiRequest<VatMonth>(`/vat/${month}/file`, { method: 'POST' })).data,
  reopen: async (month: string, reason: string) => (await apiRequest<VatMonth>(`/vat/${month}/reopen`, { method: 'POST', body: { reason } })).data,
  withholding: async (month: string) => (await apiRequest<WithholdingRow[]>(`/vat/${month}/withholding`)).data,
  /** The month side by side with TREFIN, and the months TREFIN has been loaded for. */
  trefin: async (month: string) => (await apiRequest<TrefinCompare>(`/vat/${month}/trefin`)).data,
  trefinMonths: async () => (await apiRequest<string[]>('/vat/trefin')).data,
  /** Say why a difference is fine; null takes the explanation back. */
  explainTrefin: async (month: string, key: string, note: string | null) => (await apiRequest<TrefinCompare>(`/vat/${month}/trefin/explain`, { method: 'POST', body: { key, note } })).data,
  /** The sales or purchase book as Excel, or as the file for ATK's EDI upload. */
  async downloadBook(month: string, kind: BookKind, format: 'xlsx' | 'edi', lang: Language, all: boolean): Promise<void> {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { blob, filename } = await apiDownload(`/vat/${month}/books/${kind}`, { format, lang, all, tz });
    saveDownload(blob, filename ?? `4vd-${kind}-${month}.${format === 'edi' ? 'csv' : 'xlsx'}`);
  },
  /** The book as a page to print or save as PDF. */
  bookPage: async (month: string, kind: BookKind, lang: Language, all: boolean) =>
    (await apiDownload(`/vat/${month}/books/${kind}`, { format: 'html', lang, all })).blob.text(),
  async downloadWithholding(month: string, lang: Language): Promise<void> {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { blob, filename } = await apiDownload(`/vat/${month}/withholding/download`, { lang, tz });
    saveDownload(blob, filename ?? `4vd-withholding-${month}.xlsx`);
  },
  async downloadYear(year: number, lang: Language): Promise<void> {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { blob, filename } = await apiDownload(`/vat/year/${year}/download`, { lang, tz });
    saveDownload(blob, filename ?? `4vd-vat-${year}.xlsx`);
  },
};

export const threadsApi = {
  get: async (kind: ThreadSubject, id: number) => (await apiRequest<Thread>(`/threads/${kind}/${id}`)).data,
  post: async (kind: ThreadSubject, id: number, body: string) => (await apiRequest<Thread>(`/threads/${kind}/${id}`, { method: 'POST', body: { body } })).data,
};
