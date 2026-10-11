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
  /** Percent of VAT included in the price: 18, 8 or 0. */
  vatRate: VatRate;
  /** Two-letter code of the country it comes from; starts from the barcode, can be corrected. */
  originCountry: string | null;
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
  vatRate: VatRate;
  originCountry: string | null;
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
  /** The newest invoice the sale is on; null for sales from before invoices. */
  invoice: DocumentRef | null;
}

/** Everything one customer bought at once: one invoice, one or more lines (DESIGN.md 3.5). */
export interface Checkout {
  /** "i<invoice id>", or "s<sale id>" for an older sale without an invoice. */
  key: string;
  invoice: DocumentRef | null;
  saleDate: string;
  /** The shop day it falls on (YYYY-MM-DD), for grouping. */
  day: string;
  soldBy: string | null;
  total: number;
  lines: Sale[];
}

/** One shop day's checkouts and revenue, with the list's filters applied. */
export interface CheckoutDayTotal {
  day: string;
  checkouts: number;
  revenue: number;
}

/** Kosovo's VAT rates, in percent. */
export const VAT_RATES = [18, 8, 0] as const;
export type VatRate = (typeof VAT_RATES)[number];

export type DocumentKind = 'invoice' | 'credit_note';

export interface DocumentRef {
  id: number;
  number: string;
}

export interface DocumentParty {
  name: string;
  nui: string | null;
  address: string | null;
  phone: string | null;
}

/** An invoice or credit note. Never changes once issued, except the fiscal receipt number. */
export interface SalesDocument extends DocumentRef {
  kind: DocumentKind;
  issuedAt: string;
  issuedBy: string | null;
  seller: DocumentParty;
  buyer: DocumentParty | null;
  /** The customer the buyer came from, when there is one. */
  customerId: number | null;
  /** The invoice a credit note reverses. */
  corrects: DocumentRef | null;
  reason: string | null;
  netTotal: number;
  vatTotal: number;
  total: number;
  fiscalReceiptNo: string | null;
  /** Paid at the till, or on the customer's account (their tab). */
  paymentMethod: 'till' | 'account';
  /** "YYYY-MM-DD": when an invoice on account is due. */
  dueDate: string | null;
}

export interface SalesDocumentDetail extends SalesDocument {
  lines: Array<{
    saleId: number;
    returnId: number | null;
    productName: string;
    /** The product's barcode, else its SKU, as it was when issued. */
    productCode: string | null;
    quantity: number;
    /** After any rabat. */
    unitPrice: number;
    /** Rabat in percent; null when none. */
    discountPercent: number | null;
    priceBeforeDiscount: number | null;
    vatRate: number;
    netAmount: number;
    vatAmount: number;
    total: number;
  }>;
  vatByRate: Array<{ rate: number; net: number; vat: number }>;
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
  /** The page a tap opens, e.g. a report; null opens nothing more. */
  link: string | null;
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

/** What a wipe deleted (or would delete, when `applied` is false), by table. */
export interface WipeReport {
  applied: boolean;
  keptDevelopers: string[];
  deleted: Record<string, number>;
}

export type LaunchStepKey = 'wiped' | 'shopDetails' | 'owner' | 'team' | 'reports' | 'emails' | 'phoneAlerts' | 'backups';

export interface LaunchStep {
  key: LaunchStepKey;
  /** Null when the app can't see it (backups live on GitHub and R2). */
  done: boolean | null;
  facts?: { wipedAt?: string; products?: number; sales?: number; employees?: number; lastBackupAt?: string };
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
  /** Units noted when the date was added. */
  quantity: number;
  /** How many of them are probably still on the shelf. */
  remaining: number;
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
  closedBy: string | null;
  closedAt: string | null;
  lines: OrderLine[];
  total: number;
  /** The supplier's bill for it, if one was added. */
  bill: { id: number; number: string | null; amount: number; left: number; dueOn: string | null } | null;
}

export type BillStatus = 'unpaid' | 'partly_paid' | 'paid' | 'void';
export type SupplierPaymentMethod = 'drawer' | 'cash' | 'bank';

export interface SupplierBill {
  id: number;
  supplier: { id: number; name: string };
  orderId: number | null;
  /** The supplier's own invoice number. */
  number: string | null;
  issuedOn: string;
  dueOn: string | null;
  amount: number;
  paid: number;
  left: number;
  status: BillStatus;
  overdue: boolean;
  /** Days until due (negative once late); null without a due date or once settled. */
  daysLeft: number | null;
  note: string | null;
  photoUrl: string | null;
  /** Confirmed from this scanned bill. */
  scanId: number | null;
  recordedBy: string | null;
  voidNote: string | null;
  payments: Array<{ id: number; amount: number; paidOn: string; method: SupplierPaymentMethod; note: string | null; recordedBy: string | null; voided: boolean }>;
}

export interface BillInput {
  number: string | null;
  issuedOn: string;
  dueOn: string | null;
  amount: number;
  note: string | null;
}

export interface PayablesSummary {
  owed: number;
  overdue: { count: number; amount: number };
  dueSoon: { count: number; amount: number };
  bySupplier: Array<{ supplierId: number; name: string; owed: number; overdue: number; bills: number }>;
}

export type ReportKind = 'daily' | 'weekly';
export const REPORT_SECTIONS = ['sales', 'products', 'team', 'losses', 'carwash', 'cash', 'expenses', 'tabs', 'bills', 'stock', 'approvals'] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

export interface FullReport {
  kind: ReportKind;
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  /** Still running: today's report before the day is over. */
  partial: boolean;
  generatedAt: string;
  chosenSections: ReportSection[];
  sections: Partial<{
    sales: {
      revenue: number;
      previousRevenue: number;
      change: number | null;
      profit: number;
      margin: number | null;
      salesCount: number;
      unitsSold: number;
      averageSale: number;
      netProfit: number;
      byDay: Array<{ day: string; revenue: number }>;
    };
    products: Array<{ name: string; unitsSold: number; revenue: number; profit: number }>;
    team: Array<{ name: string; salesCount: number; revenue: number; profit: number }>;
    losses: { refunds: number; stockLosses: number };
    carwash: { total: number; each: Array<{ name: string; carwash: number; change: number; total: number }> };
    cash: Array<{ day: string; place: string; counted: number; float: number; expected: number | null; difference: number | null }>;
    expenses: { total: number; byCategory: Array<{ category: string; amount: number }> };
    tabs: { owed: number; customers: number; overdue: Array<{ name: string; balance: number }> };
    bills: {
      owed: number;
      overdue: { count: number; amount: number };
      dueSoon: { count: number; amount: number };
      paid: { count: number; total: number };
      next: Array<{ supplier: string; number: string | null; left: number; dueOn: string | null; overdue: boolean }>;
    };
    stock: { soldOut: string[]; runningOut: string[]; expiring: string[]; other: number };
    approvals: { total: number; returns: number; writeOffs: number; countLines: number };
  }>;
}

export interface ReportSettings {
  daily: { enabled: boolean; hour: number };
  /** day: 1 = Monday ... 7 = Sunday. */
  weekly: { enabled: boolean; day: number; hour: number };
  sections: ReportSection[];
  email: boolean;
}

export interface ReorderSuggestion {
  productId: number;
  productName: string;
  sku: string | null;
  imageUrl: string | null;
  categoryId: number;
  categoryName: string;
  /** Null when no cost price is set, so its stock has no known value. */
  costPrice: number | null;
  lastRestockedAt: string | null;
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

export type TodoSeverity = 'urgent' | 'check' | 'idea';
/** What a To do item's one button does. */
export type TodoVerb = 'decide' | 'restock' | 'checkExpiry' | 'look' | 'openTab' | 'payBill' | 'markChecked' | 'closeDay' | 'endShift' | 'checkBill';

/** Something someone must act on, worked out from the shop's state; it clears itself (DESIGN.md 3.3). */
export interface TodoItem {
  key: string;
  kind: string;
  severity: TodoSeverity;
  title: string;
  detail: string;
  verb: TodoVerb;
  /** The page that fixes it. */
  to: string;
  productId?: number;
  customerId?: number;
  cashCountId?: number;
}

export interface Attention {
  todo: TodoItem[];
  /** The one "waiting" number: Urgent and Check items. */
  count: number;
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
  /** A refund is a return taken off the tab. */
  kind: 'charge' | 'payment' | 'refund';
  amount: number;
  note: string | null;
  saleId: number | null;
  /** The sale was undone, so this charge no longer counts. */
  undone: boolean;
  at: string;
  by: string | null;
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

/** What putting a record back to one of its history entries would change. */
export interface RestorePlan {
  entityType: HistoryEntity;
  entityId: number;
  /** The newest entry this was worked out from; the restore is refused if a newer one appears. */
  latestEntryId: number;
  /** `from` is what it is now, `to` what it goes back to. */
  changes: FieldChange[];
}

export interface ActivityEntry {
  id: number;
  action: string;
  entityType: string | null;
  entityId: number | null;
  summary: string;
  details: Record<string, unknown> | null;
  /** The fields it changed, before and after. */
  changes: FieldChange[];
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
  /** Change left in each drawer every night; the cash check takes it off the count. */
  cashFloatShop: number;
  /** Days a customer has to pay an invoice put on their account. */
  paymentTermsDays: number;
  /** The most rabat, in percent, an employee may give; owners and admins may give any. */
  employeeDiscountLimit: number;
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
  /** Who looked at the difference; null until someone does. */
  checkedBy: string | null;
  checkedAt: string | null;
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

/** The end-of-day checklist. It only reports: nothing is locked. */
/** One thing that closes the day; the server defines them for both apps. */
export type DayStep =
  | { kind: 'drawer'; key: string; place: CashPlace; carwashId: number | null; name: string | null; done: boolean; countedBy: string | null }
  | { kind: 'carwash'; key: string; carwashId: number; name: string; done: boolean }
  | { kind: 'expenses'; key: 'expenses'; done: boolean; count: number; total: number; noneMarked: boolean; noneMarkedBy: string | null }
  | { kind: 'requests'; key: 'requests'; done: boolean; waiting: number };

/** One shop day: its close-the-day steps and what happened. */
export interface ShopDay {
  /** "2026-10-10", in shop time. */
  day: string;
  today: string;
  steps: DayStep[];
  done: number;
  total: number;
  allDone: boolean;
  details: {
    counts: CashCount[];
    carwash: Array<{ id: number; name: string; takings: { carwash: number; change: number } | null }>;
    expenses: Expense[];
  } | null;
}

export type PushTopic = 'stock' | 'approvals' | 'decisions' | 'summary';

/** How one device fared with the test alert. */
export interface TestDelivery {
  kind: 'expo' | 'web';
  /** Apple, Google, Microsoft, Mozilla or Expo. */
  service: string;
  delivered: boolean;
  problem: string | null;
  /** The push service no longer knew it, so it was removed. */
  removed: boolean;
}

export interface PushSettings {
  topics: Array<{ topic: PushTopic; enabled: boolean }>;
  /** Phones and browsers getting this person's alerts. */
  deviceCount: number;
  /** Alerts are on in the dashboard, so the team app stays quiet for this person. */
  dashboardOnly: boolean;
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
  id: number;
  name: string;
  address: string | null;
  phone: string | null;
  nui: string | null;
  currency: string;
  timeZone: string | null;
  logoUrl: string | null;
  bankName: string | null;
  iban: string | null;
  invoiceNote: string | null;
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

/** A product someone at the counter asked to add; approving it creates the product. */
export interface ProductRequest {
  id: number;
  status: ApprovalStatus;
  name: string;
  category: { id: number; name: string } | null;
  price: number;
  vatRate: number;
  barcode: string | null;
  originCountry: string | null;
  photoUrl: string | null;
  stock: number;
  note: string | null;
  requestedBy: { id: number; name: string } | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  productId: number | null;
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

/** What an answer shows besides its text. */
export interface AnswerExtras {
  tables: Array<{ title: string; columns: string[]; rows: Array<Array<string | number>> }>;
  charts: Array<{ title: string; unit: 'eur' | 'count'; bars: Array<{ label: string; value: number }> }>;
  /** Pages inside the app the answer mentions. */
  links: Array<{ label: string; to: string }>;
}

export interface AssistantChat {
  id: number;
  title: string;
  updatedAt: string;
}

export interface AssistantMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  extras: AnswerExtras | null;
  createdAt: string;
}

export interface AssistantThread {
  chat: AssistantChat;
  messages: AssistantMessage[];
}

export interface PatternFigures {
  revenue: number;
  profit: number;
  unitsSold: number;
  salesCount: number;
}

/** When sales happen, in the shop's time zone. */
export interface SalesPatterns {
  /** Every shop day in the range, oldest first, quiet days as zero. */
  days: Array<{ periodStart: string } & PatternFigures>;
  /** 0–23. */
  hours: Array<{ hour: number } & PatternFigures>;
  /** Monday (1) to Sunday (7); `days` is how many of that weekday the range holds. */
  weekdays: Array<{ weekday: number; days: number; averageRevenue: number } & PatternFigures>;
}

/** What the AI read off a supplier's bill; anything it couldn't read is null. */
export interface BillReading {
  supplier: { name: string | null; nui: string | null };
  number: string | null;
  issuedOn: string | null;
  dueOn: string | null;
  pricesIncludeVat: boolean;
  lines: Array<{
    code: string | null;
    barcode: string | null;
    name: string;
    quantity: number;
    unit: string | null;
    unitsPerPack: number | null;
    unitPrice: number | null;
    discountPercent: number | null;
    vatRate: number | null;
    lineTotal: number | null;
  }>;
  totals: { net: number | null; vat: number | null; gross: number | null };
  remarks: string | null;
}

/** The one thing to look at on a scanned line, most important first. */
export type ScanStamp = 'new' | 'unsure' | 'barcode' | 'price' | 'match';

export interface ScanLineMatch {
  productId: number | null;
  matchedBy: 'code' | 'barcode' | 'sku' | 'name' | null;
  unitsPerPack: number;
  pieces: number;
  /** One piece, without VAT, after rabat. */
  unitCost: number | null;
  oldCost: number | null;
  oldBarcode: string | null;
  stamp: ScanStamp;
}

export interface BillScan {
  id: number;
  status: 'waiting' | 'confirmed' | 'discarded';
  scannedBy: string | null;
  scannedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  pages: Array<{ url: string; isPdf: boolean }>;
  reading: BillReading;
  supplier: { id: number; name: string; matchedBy: 'nui' | 'name' | 'chosen' } | null;
  openOrders: PurchaseOrder[];
  lines: Array<{ read: BillReading['lines'][number]; match: ScanLineMatch }>;
  products: Array<{ id: number; name: string }>;
  totals: { linesTotal: number; printedTotal: number | null; adds: boolean };
  duplicateBillId: number | null;
  billId: number | null;
  orderId: number | null;
  /** The last confirm's choices, after a reopen. */
  previous: ConfirmScanInput | null;
}

export interface WaitingScan {
  id: number;
  supplierName: string | null;
  number: string | null;
  amount: number | null;
  scannedBy: string | null;
  scannedAt: string;
}

export interface ConfirmScanInput {
  supplierId: number;
  orderId: number | null;
  bill: BillInput;
  categoryId: number | null;
  lines: Array<{
    readIndex?: number;
    productId: number | null;
    newProduct: { name: string; barcode: string | null; price: number; vatRate: number } | null;
    code: string | null;
    pieces: number;
    unitsPerPack: number;
    unitCost: number | null;
    updateCost: boolean;
    barcode: string | null;
    updateBarcode: boolean;
  }>;
}

/** Records that have a History card (the server's activity entity types). */
export type HistoryEntity = 'product' | 'category' | 'user' | 'sale' | 'customer' | 'supplier' | 'order' | 'document' | 'bill' | 'bill_scan' | 'business' | 'promotion' | 'expense' | 'stock_count';
