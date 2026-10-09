// Mirrors the shapes the backend returns (see docs/API.md).

export type Language = 'en' | 'sq';

export type UserRole = 'developer' | 'admin' | 'owner' | 'employee' | 'family';

export interface User {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  phone: string | null;
  /** Path to the photo (use mediaSrc); null shows initials. */
  avatarUrl: string | null;
  theme: 'light' | 'dark' | 'system';
  /** The language they read 4VD in. */
  language: Language;
  /** Gets the Monday report email (admins). */
  emailWeeklyReport: boolean;
  /** Euros of sales (after refunds) hoped for each month; null when not set. */
  monthlyTarget: number | null;
  commissionPercent: number | null;
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
  /** Scanned at the counter: the manufacturer's, or one 4VD made. */
  barcode: string | null;
  imageUrl: string | null;
  isActive: boolean;
  category: { id: number; name: string };
  price: number;
  costPrice?: number | null;
  stock: { quantity: number; reorderLevel: number; isInStock: boolean; isLowStock: boolean };
  bulkPricingTiers: PricingTier[];
  /** The running promotion, with the price it gives for one unit. */
  promotion: { id: number; name: string; percentOff: number; endsAt: string; price: number } | null;
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
  imageUrl: string | null;
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

// Returns, damage and recounts have their own flows (Sales, Write off, Counts).
export const MANUAL_STOCK_REASONS = ['Restock', 'Manual adjustment'] as const;
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
  /** Units returned or waiting for a return decision. */
  returnedQuantity: number;
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
  /** Only sales of products with a cost price, like the reports' profit. */
  profit: number;
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

export const USER_ROLES: UserRole[] = ['developer', 'admin', 'owner', 'employee', 'family'];

export interface PeriodTotals {
  /** After refunds. */
  revenue: number;
  refunds: number;
  stockLosses: number;
  lossUnitsWithoutCost: number;
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
  /** Beside the shop, never inside its revenue or profit. */
  carwash: { current: CarwashTotals; previous: CarwashTotals; change: number | null; byCarwash: CarwashTotalsByCarwash[] };
  expenses: { current: number; previous: number };
  /** Shop profit + carwash takings − expenses. */
  netProfit: { current: number; previous: number; change: number | null };
}

export const EXPENSE_CATEGORIES = ['rent', 'electricity', 'water', 'wages', 'supplies', 'repairs', 'taxes', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const EXPENSE_PLACES = ['shop', 'carwash', 'both'] as const;
export type ExpensePlace = (typeof EXPENSE_PLACES)[number];

export interface Expense {
  id: number;
  /** "2026-10-04" */
  day: string;
  amount: number;
  category: ExpenseCategory;
  place: ExpensePlace;
  /** Which carwash, for a carwash expense. */
  carwashId: number | null;
  carwashName: string | null;
  note: string | null;
  /** Set when a monthly rule added it. */
  recurringId: number | null;
  addedBy: string | null;
}

export interface ExpenseTotals {
  total: number;
  byPlace: Record<ExpensePlace, number>;
  /** The carwash part of `byPlace`, split by carwash. */
  byCarwash: Array<{ carwashId: number; name: string; total: number }>;
  byCategory: Record<ExpenseCategory, number>;
}

export interface RecurringExpense {
  id: number;
  amount: number;
  category: ExpenseCategory;
  place: ExpensePlace;
  carwashId: number | null;
  carwashName: string | null;
  note: string | null;
  dayOfMonth: number;
  addedBy: string | null;
}

export type LaunchStepKey = 'wiped' | 'shopDetails' | 'owner' | 'team' | 'weeklyEmail' | 'emails' | 'phoneAlerts' | 'backups';

export interface LaunchStep {
  key: LaunchStepKey;
  /** Null when the app can't see it (backups live on GitHub and R2). */
  done: boolean | null;
  facts?: { wipedAt?: string; products?: number; sales?: number; employees?: number };
}

export interface CarwashTotals {
  carwash: number;
  /** What the change machine made: notes changed into coins. */
  change: number;
  /** Carwash + change. */
  total: number;
  /** How many days have takings entered. */
  days: number;
}

export interface CarwashTotalsByCarwash extends CarwashTotals {
  carwashId: number;
  name: string;
}

/** A carwash the business runs; archived ones keep their history. */
export interface Carwash {
  id: number;
  name: string;
  /** Change left in its drawer every night. */
  cashFloat: number;
  archived: boolean;
}

export interface CarwashDay {
  carwashId: number;
  carwashName: string;
  /** "2026-10-04" */
  day: string;
  carwash: number;
  change: number;
  total: number;
  recordedBy: string | null;
  updatedAt: string;
}

export interface TeamRow {
  userId: number;
  name: string;
  role: UserRole;
  /** Deactivated or removed since; kept so their past sales still show. */
  hasLeft: boolean;
  salesCount: number;
  refunds: number;
  unitsSold: number;
  revenue: number;
  profit: number;
  averageSale: number;
  monthlyTarget: number | null;
  commissionPercent: number | null;
  /** Revenue after refunds × commission; null when none is set. */
  commission: number | null;
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

export interface ExpiryDate {
  id: number;
  productId: number;
  productName: string;
  quantity: number;
  /** "2026-10-12" */
  expiresOn: string;
  /** Negative once it has passed. */
  daysLeft: number;
  note: string | null;
  addedBy: string | null;
}

export interface Supplier {
  id: number;
  name: string;
  /** Older suppliers may not have one yet. */
  nui: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
}

export interface OrderLine {
  id: number;
  productId: number;
  productName: string;
  sku: string | null;
  quantity: number;
  unitCost: number | null;
  receivedQuantity: number | null;
}

export interface PurchaseOrder {
  id: number;
  supplier: { id: number; name: string; phone: string | null; email: string | null };
  status: 'open' | 'received' | 'cancelled';
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  closedAt: string | null;
  lines: OrderLine[];
  total: number;
}

export interface ReorderSuggestion {
  productId: number;
  productName: string;
  quantity: number;
  reorderLevel: number;
  averageDailySales: number;
  daysLeft: number | null;
  suggestedOrder: number;
  /** Last 2 weeks against the 6 before; null without enough history. */
  trend: 'rising' | 'falling' | 'steady' | null;
  lastSoldAt: string | null;
}

export type InsightSeverity = 'urgent' | 'warning' | 'info';

export interface Insight {
  kind: 'sold_out' | 'running_out' | 'missing_stock' | 'unusual_sale' | 'below_cost' | 'dead_stock' | 'tab_overdue';
  severity: InsightSeverity;
  title: string;
  detail: string;
  /** Null for insights about a customer's tab. */
  productId: number | null;
  customerId?: number;
}

export type CustomerKind = 'person' | 'business';

export interface Customer {
  id: number;
  name: string;
  kind: CustomerKind;
  /** A business's NUI; null for a person. */
  nui: string | null;
  phone: string | null;
  note: string | null;
  balance: number;
  /** When the oldest unpaid charge was made; null when nothing is owed. */
  owingSince: string | null;
  lastPaymentAt: string | null;
  archived: boolean;
}

export interface TabEntry {
  id: number;
  kind: 'charge' | 'payment';
  amount: number;
  note: string | null;
  saleId: number | null;
  /** The sale was undone, so this charge no longer counts. */
  undone: boolean;
  at: string;
  by: string | null;
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
  /** Null for entries that can't be undone. */
  undo: UndoInfo | null;
}

export type UndoKind =
  | 'sale'
  | 'return'
  | 'write_off'
  | 'count_line'
  | 'stock'
  | 'product_edit'
  | 'pricing_edit'
  | 'settings_edit'
  | 'reorder_edit'
  | 'promotion';

/** What an undo does; the dashboard words it (components/activity/activityText). */
export interface UndoEffect {
  stock?: { product: string; delta: number };
  money?: { amount: number; day: string };
  fields?: Array<{ field: string; from: unknown; to: unknown }>;
}

export interface UndoInfo {
  state: 'undoable' | 'undone' | 'locked' | 'forbidden';
  /** Whether the viewer may undo or restore this person's entries at all. */
  allowed: boolean;
  kind: UndoKind;
  undoneBy: { id: number; name: string } | null;
  undoneAt: string | null;
  note: string | null;
  effect: UndoEffect;
  lockedReason: 'linked_return' | 'not_approved' | 'from_return' | 'changed_since' | 'cannot_restore' | null;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ReturnCondition = 'resellable' | 'damaged';
export const WRITE_OFF_REASONS = ['damaged', 'lost', 'expired', 'other'] as const;
export type WriteOffReason = (typeof WRITE_OFF_REASONS)[number];
export type CountStatus = 'open' | 'submitted' | 'closed' | 'cancelled';
export type CountLineStatus = 'match' | 'pending' | 'approved' | 'rejected';

export interface PersonRef {
  id: number;
  name: string;
}

export interface AppSettings {
  refundApprovalLimit: number;
  returnWindowDays: number;
  minimumMarginPercent: number;
  /** Hour (0–23, shop time) the daily summary goes out. */
  dailySummaryHour: number;
  /** Change left in each drawer every night; the cash check takes it off the count. */
  cashFloatShop: number;
}

export type CashPlace = 'shop' | 'carwash';

export interface CashCount {
  id: number;
  place: CashPlace;
  /** Which carwash; null for the shop. */
  carwashId: number | null;
  carwashName: string | null;
  /** "2026-10-04" */
  day: string;
  float: number;
  counted: number;
  /** Null when the carwash had no takings entered to compare with. */
  expected: number | null;
  /** Below 0 is short, above 0 is over; null when there's nothing to compare with. */
  difference: number | null;
  note: string | null;
  countedBy: string | null;
  countedAt: string;
}

export interface CashPlaceToday {
  place: CashPlace;
  carwashId: number | null;
  /** The carwash's name; null for the shop. */
  name: string | null;
  float: number;
  countedBy: string | null;
  countedAt: string | null;
}

export type PushTopic = 'stock' | 'approvals' | 'decisions' | 'summary';

export interface PushSettings {
  topics: Array<{ topic: PushTopic; enabled: boolean }>;
  /** Phones and browsers getting this person's alerts. */
  deviceCount: number;
  /** Null when the server has no Web Push keys. */
  webPushPublicKey: string | null;
}

export interface PriceSuggestion {
  productId: number;
  currentPrice: number;
  costPrice: number | null;
  minimumPrice: number | null;
  suggestedPrice: number;
  decision: 'raise' | 'lower' | 'keep';
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  reasons: string[];
  watchOut: string;
  provider: string;
}

export interface LoginResult {
  token: string;
  refreshToken: string;
  user: User;
}

export interface Invite {
  id: number;
  email: string;
  role: UserRole;
  invitedBy: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface InvitePreview {
  email: string;
  role: UserRole;
  shopName: string;
  invitedBy: string | null;
  /** The invite page opens in this language. */
  language: Language;
}

export interface Business {
  name: string;
  address: string | null;
  phone: string | null;
  nui: string | null;
  currency: string;
  timeZone: string | null;
  logoUrl: string | null;
}

export interface Security {
  hasPassword: boolean;
  googleEmail: string | null;
}

export interface Session {
  id: string;
  device: string;
  ip: string | null;
  lastUsedAt: string | null;
  startedAt: string;
  current: boolean;
}

export type PromotionStatus = 'scheduled' | 'running' | 'finished' | 'ended';

export interface Promotion {
  id: number;
  name: string;
  percentOff: number;
  product: PersonRef | null;
  category: PersonRef | null;
  startsAt: string;
  /** End-exclusive: "until 7 Oct" ends at the start of 8 Oct. */
  endsAt: string;
  endedEarlyAt: string | null;
  status: PromotionStatus;
  createdBy: string | null;
  createdAt: string;
}

export interface PriceChange {
  changedAt: string;
  changedBy: string | null;
  price: { from: number | null; to: number } | null;
  costPrice: { from: number | null; to: number | null } | null;
}

export interface ReturnItem {
  id: number;
  saleId: number;
  productId: number;
  productName: string;
  quantity: number;
  refundAmount: number;
  condition: ReturnCondition;
  notes: string | null;
  status: ApprovalStatus;
  needsApprovalBecause: string[];
  soldBy: PersonRef | null;
  saleDate: string;
  requestedBy: PersonRef | null;
  requestedAt: string;
  decidedBy: PersonRef | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface WriteOff {
  id: number;
  productId: number;
  productName: string;
  quantity: number;
  reason: WriteOffReason;
  unitCost: number | null;
  value: number | null;
  returnId: number | null;
  notes: string | null;
  status: ApprovalStatus;
  requestedBy: PersonRef | null;
  requestedAt: string;
  decidedBy: PersonRef | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface StockCountSummary {
  id: number;
  category: PersonRef | null;
  status: CountStatus;
  startedBy: PersonRef | null;
  startedAt: string;
  submittedAt: string | null;
  closedAt: string | null;
}

export interface StockCountLine {
  productId: number;
  productName: string;
  sku: string | null;
  categoryName: string;
  countedQuantity: number | null;
  status: CountLineStatus | null;
  decisionNote: string | null;
  expectedQuantity?: number;
  difference?: number;
  value?: number | null;
}

export interface StockCount extends StockCountSummary {
  totals: { products: number; counted: number; differences: number | null; pending: number | null; shortageValue: number | null };
  lines: StockCountLine[];
}

export interface ApprovalSummary {
  returns: number;
  writeOffs: number;
  countLines: number;
  total: number;
}
