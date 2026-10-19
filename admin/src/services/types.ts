// Mirrors the shapes the backend returns (see its DTOs in backend/src/services).

export type Language = 'en' | 'sq';

export type UserRole = 'developer' | 'admin' | 'owner' | 'employee' | 'family' | 'accountant';

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

/** Someone on the People page: their account and when they last used 4VD. */
export interface TeamMember extends User {
  /** Their newest login or refresh on any device; null if never. */
  lastActiveAt: string | null;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  /** Sums over every matching record, not just this page (a list's totals row). */
  totals?: Record<string, number>;
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
  /** Further barcodes that also find this product when scanned, oldest first. */
  otherBarcodes: string[];
  imageUrl: string | null;
  isActive: boolean;
  category: { id: number; name: string };
  price: number;
  /** Percent of VAT included in the price: 18, 16 (the old rate), 8 or 0. */
  vatRate: VatRate;
  /** At 0%: exempt from VAT altogether (box 9 of the return), rather than taxed at 0%. */
  vatExempt: boolean;
  /** Two-letter code of the country it comes from; starts from the barcode, can be corrected. */
  originCountry: string | null;
  /** What a business pays, with VAT; null: the shelf price. */
  wholesalePrice: number | null;
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
  wholesalePrice?: number | null;
  imageUrl: string | null;
  sku: string | null;
  isActive: boolean;
  vatRate: VatRate;
  vatExempt?: boolean;
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
  /** Its lines in TREFIN's starting stocks, corrections and counts: history, they moved nothing here. */
  trefinHistory: Array<{
    id: number;
    documentId: number;
    kind: TrefinStockKind;
    number: string | null;
    /** "YYYY-MM-DD". */
    dated: string;
    source: string;
    quantity: number;
    counted: number | null;
    unitCost: number | null;
  }>;
}

export type TrefinStockKind = 'opening' | 'correction' | 'count';

/** TREFIN's starting stock, a correction or a count: to look at, never a stock move here. */
export interface TrefinStockDocument {
  id: number;
  kind: TrefinStockKind;
  number: string | null;
  /** "YYYY-MM-DD". */
  dated: string;
  /** Which TREFIN database (said in words by fromTrefin.databases). */
  source: string;
  lineCount: number;
  /** The lines at TREFIN's cost. */
  value: number;
}

export interface TrefinStockDocumentDetail extends TrefinStockDocument {
  lines: Array<{ productId: number | null; productName: string; sku: string | null; quantity: number; counted: number | null; unitCost: number | null }>;
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
  /** The old till's receipt number, on sales imported from it. */
  receiptNo: string | null;
  /** Units returned or waiting for a return decision. */
  returnedQuantity: number;
  /** The newest invoice the sale is on; null for sales from before invoices. */
  invoice: DocumentRef | null;
}

/** Everything one customer bought at once: one invoice, one or more lines (DESIGN.md 3.5). */
export interface Checkout {
  /** "i<invoice id>", "r<receipt no>@<day>" for an imported receipt, or "s<sale id>" for an older sale with neither. */
  key: string;
  invoice: DocumentRef | null;
  /** The old till's receipt number, when the checkout was imported from it. */
  receiptNo: string | null;
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
/** 16% is the old standard rate, still on some products and bills. A 0% product can also be exempt (vatExempt). */
export const VAT_RATES = [18, 16, 8, 0] as const;
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
  /** An invoice TREFIN issued: history, to look at only. */
  fromTrefin: boolean;
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
    /** At 0%: exempt from VAT. */
    vatExempt?: boolean;
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

export const USER_ROLES: UserRole[] = ['developer', 'admin', 'owner', 'accountant', 'employee', 'family'];

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

export const EXPENSE_CATEGORIES = [
  'rent',
  'electricity',
  'water',
  'internet',
  'fuel',
  'transport',
  'repairs',
  'cleaning',
  'advertising',
  'bank_fees',
  'professional',
  'insurance',
  'office',
  'supplies',
  'wages',
  'taxes',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const EXPENSE_PLACES = ['shop', 'carwash', 'both'] as const;
export type ExpensePlace = (typeof EXPENSE_PLACES)[number];

export interface Expense {
  id: number;
  /** The bill it is on: an expense is a bill paid on the spot. */
  billId: number;
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
  supplierName: string | null;
  /** Paid when entered; a cost on a bill to pay later is changed on its bill. */
  paidNow: boolean;
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
  supplier: { id: number; name: string } | null;
  amount: number;
  /** The first cost line's category. */
  category: ExpenseCategory | null;
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

export type LaunchStepKey = 'wiped' | 'trefin' | 'opening' | 'shopDetails' | 'owner' | 'team' | 'reports' | 'emails' | 'phoneAlerts' | 'backups';

export interface LaunchStep {
  key: LaunchStepKey;
  /** Null when the app can't see it (backups live on GitHub and R2). */
  done: boolean | null;
  facts?: { wipedAt?: string; importedAt?: string; products?: number; sales?: number; employees?: number; lastBackupAt?: string };
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

export interface Supplier extends PartnerDetails {
  id: number;
  name: string;
  /** Older suppliers may not have one yet. */
  nui: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  /** From another country: its bills are imports, and 4VD handles their VAT. */
  abroad: boolean;
  /** What its bills usually are, so a new bill starts there. */
  usualKind: BillLineKind | null;
  usualCategory: string | null;
  usualVatRate: VatRate | null;
  usualVatExempt?: boolean;
  withholdingType: WithholdingType | null;
}

export const BILL_LINE_KINDS = ['product', 'cost', 'equipment'] as const;
export type BillLineKind = (typeof BILL_LINE_KINDS)[number];
export const EQUIPMENT_CATEGORIES = ['furniture', 'equipment', 'vehicle', 'building', 'other'] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];
/** Tax the shop holds back from a payment and pays the tax office instead, with its rate in percent. */
export const WITHHOLDING_RATES = { interest: 10, royalties: 10, lottery: 10, rent: 9, entertainers: 5, nonresident_services: 5, special: 3 } as const;
export type WithholdingType = keyof typeof WITHHOLDING_RATES;
export const WITHHOLDING_TYPES = Object.keys(WITHHOLDING_RATES) as WithholdingType[];
export type CustomsPaidMethod = 'bank' | 'cash';

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

/** history: a bill from TREFIN, only to look at. */
export type BillStatus = 'unpaid' | 'partly_paid' | 'paid' | 'void' | 'history';

/** Which records a list shows: made in 4VD, or brought over from TREFIN's history. */
export type RecordSource = '4vd' | 'trefin';

/** What a supplier or customer can carry besides name, NUI and phone (TREFIN kept them all). */
export interface PartnerDetails {
  address: string | null;
  city: string | null;
  /** The business registration no. (NRB). */
  businessNo: string | null;
  fiscalNo: string | null;
  vatNo: string | null;
  iban: string | null;
  contactPerson: string | null;
  mobile: string | null;
}
export type SupplierPaymentMethod = 'drawer' | 'cash' | 'bank';
/** A payment row can also be a return or credit taken off the bill. */
export type BillPaymentMethod = SupplierPaymentMethod | 'credit';

export interface BillLine {
  id: number;
  kind: BillLineKind;
  productId: number | null;
  productName: string | null;
  quantity: number | null;
  /** The price for one, as the paper shows it. */
  unitPrice: number | null;
  category: string | null;
  description: string | null;
  vatRate: number;
  /** At 0%: exempt from VAT, not taxed at 0%. */
  vatExempt: boolean;
  net: number;
  vat: number;
  gross: number;
  /** The net plus its share of an import's duty and transport. */
  landed: number;
  /** Transport on an import, added to the goods' cost. */
  spread: boolean;
  /** VAT charged to yourself on a service from abroad. */
  selfVat: number;
  /** The stock came in with a delivery (an order), not with the bill. */
  fromDelivery: boolean;
}

export interface SupplierBill {
  id: number;
  /** A bill, or a return or credit against one. */
  kind: 'bill' | 'credit';
  /** Null for an expense paid to nobody in particular. */
  supplier: { id: number; name: string } | null;
  orderId: number | null;
  /** The supplier's own invoice number. */
  number: string | null;
  issuedOn: string;
  /** The VAT month it counts in ("2026-10") when it came after its own month was filed; null: its own month. */
  vatMonth: string | null;
  dueOn: string | null;
  /** What the supplier is owed (a return or credit: what it gives back). */
  amount: number;
  /** What the paper adds up to: the amount plus any tax held back. */
  total: number;
  /** The VAT in the amount; null when nobody entered it. */
  vatAmount: number | null;
  /** VAT to claim back: the paper's and the customs VAT. */
  vatToClaim: number;
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
  /** An expense: paid when it was entered. */
  paidNow: boolean;
  pricesIncludeVat: boolean;
  /** From a supplier abroad: an import. */
  abroad: boolean;
  customs: { vat: number; duty: number; method: CustomsPaidMethod } | null;
  withholding: { type: WithholdingType; rate: number; amount: number } | null;
  place: ExpensePlace;
  carwash: { id: number; name: string } | null;
  /** Made by a monthly repeat. */
  repeatId: number | null;
  /** A return or credit: the bill it is against. */
  creditFor: { id: number; number: string | null } | null;
  /** A return: its units went back out of stock. */
  returnsStock: boolean;
  /** Returns and credits against this bill. */
  credits: Array<{ id: number; number: string | null; issuedOn: string; amount: number; returnsStock: boolean; voided: boolean }>;
  lines: BillLine[];
  /** From TREFIN's history: never owed, posted or counted for VAT here, and it can't be changed. */
  fromTrefin: boolean;
  payments: Array<{
    id: number;
    /** The bill it paid (on a return or credit: the bill it went against). */
    billId: number;
    amount: number;
    paidOn: string;
    method: BillPaymentMethod;
    /** Where the money came from; null for a credit. */
    place: { id: number; kind: MoneyPlaceKind; name: string | null } | null;
    /** Paid together with other bills in one payment. */
    groupId: number | null;
    /** For a credit: the return or credit that paid it. */
    credit: { id: number; number: string | null } | null;
    note: string | null;
    recordedBy: string | null;
    voided: boolean;
  }>;
}

/** One line of the bill form, as the server takes it. */
export interface BillLineInput {
  kind: BillLineKind;
  productId?: number | null;
  quantity?: number | null;
  unitPrice?: number | null;
  category?: string | null;
  description?: string | null;
  /** A cost's or equipment's amount as on the paper. */
  amount?: number | null;
  vatRate?: number | null;
  vatExempt?: boolean | null;
}

/** The one bill form: lines, and what 4VD needs to work out the rest. */
export interface BillFormInput {
  supplierId: number | null;
  number: string | null;
  issuedOn: string;
  dueOn: string | null;
  note: string | null;
  lines: BillLineInput[];
  pricesIncludeVat: boolean;
  customs: { vat: number; duty: number; method: CustomsPaidMethod } | null;
  withholdingType: WithholdingType | null;
  /** Paid from a place, or only how, for that kind's usual place. */
  paidNow: { method?: SupplierPaymentMethod; placeId?: number } | null;
  place: ExpensePlace;
  carwashId: number | null;
  repeatMonthly: boolean;
  /** New shelf prices chosen from the price alerts. */
  prices: Array<{ productId: number; price: number }>;
}

export interface CreditInput {
  /** A return: the product lines' units go back out of stock. Otherwise only what's owed goes down. */
  returnsStock: boolean;
  number: string | null;
  issuedOn: string;
  note: string | null;
  pricesIncludeVat: boolean;
  lines: BillLineInput[];
}

/** What a bill will do, worked out before it is saved. */
export interface BillPreview {
  /** Each line's figures, in the order sent. */
  lines: Array<{ net: number; vat: number; landed: number; spread: boolean; selfVat: number; unitCost: number | null }>;
  /** What the paper adds up to. */
  total: number;
  /** Added to stock, at cost without VAT. */
  stock: number;
  /** Booked as costs, without VAT, per category. */
  costs: Record<string, number>;
  /** Booked as equipment, without VAT. */
  equipment: number;
  /** VAT the shop claims back: the paper's plus the customs VAT. */
  vatToClaim: number;
  /** VAT charged to yourself and claimed back at once. */
  selfVat: number;
  /** Paid at the border. */
  customs: number;
  withholdingRate: number;
  withheld: number;
  /** What the supplier is owed. */
  owed: number;
  abroad: boolean;
  /** Customs only apply to goods and equipment from abroad. */
  hasGoods: boolean;
  priceAlerts: Array<{
    productId: number;
    name: string;
    oldCost: number | null;
    newCost: number;
    price: number;
    /** Margin in percent of the shelf price, before and after. */
    marginBefore: number | null;
    marginAfter: number;
    /** A shelf price that keeps the old margin. */
    suggestedPrice: number;
  }>;
}

export interface BillInput {
  number: string | null;
  issuedOn: string;
  dueOn: string | null;
  amount: number;
  /** The VAT in the amount, to claim back; null when not known. */
  vatAmount?: number | null;
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
export type TodoVerb = 'decide' | 'restock' | 'checkExpiry' | 'look' | 'openTab' | 'payBill' | 'markChecked' | 'closeDay' | 'endShift' | 'checkBill' | 'reviewDuplicates' | 'fileVat' | 'payTm' | 'answer';

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

export interface Customer extends PartnerDetails {
  id: number;
  name: string;
  kind: CustomerKind;
  /** A business's NUI; null for a person. */
  nui: string | null;
  phone: string | null;
  note: string | null;
  /** The most they may owe on their tab, and their usual discount in percent; null: none. */
  creditLimit: number | null;
  discountPercent: number | null;
  balance: number;
  /** When the oldest unpaid charge was made; null when nothing is owed. */
  owingSince: string | null;
  lastPaymentAt: string | null;
  archived: boolean;
  /** Everything they bought (tab or paid at the till), returns taken off. */
  spent: number;
  spentThisYear: number;
  purchases: number;
  lastPurchaseAt: string | null;
}

export interface CustomerDetail extends Customer {
  entries: TabEntry[];
  /** What is still owed: each invoice, and the charges on no invoice. */
  openItems: OpenItem[];
  topProducts: Array<{ productId: number; name: string; quantity: number; total: number }>;
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
  /** The account that counted it; null once that account is removed. */
  countedById: number | null;
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
  /** What sold at its price so far. */
  sold: PromotionSales;
}

/** Sold at a promotion's price; `discount` is what customers saved. */
export interface PromotionSales {
  pieces: number;
  revenue: number;
  discount: number;
  profit: number;
}

export interface PromotionPreviewLine {
  id: number;
  name: string;
  price: number;
  newPrice: number;
  cost: number | null;
  lowestAllowed: number | null;
  profitEach: number | null;
  tooLow: boolean;
}

export interface PromotionResults {
  promotion: Promotion;
  days: number;
  during: { pieces: number; revenue: number };
  before: { pieces: number; revenue: number };
  daily: Array<{ day: string; pieces: number; revenue: number; during: boolean }>;
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

/** A count in the list, with its totals. Differences stay null for employees until it closes. */
export interface StockCountListItem extends StockCountSummary {
  totals: { products: number; counted: number; differences: number | null; pending: number | null; shortageValue: number | null };
}

export interface StockCount extends StockCountListItem {
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

/** One side of a pair of products that may be the same item. */
export interface DuplicateSide {
  id: number;
  name: string;
  barcode: string | null;
  otherBarcodes: string[];
  sku: string | null;
  price: number;
  costPrice: number | null;
  imageUrl: string | null;
  category: string;
  stock: number;
  unitsSold90d: number;
  unitsSold: number;
  lastSoldAt: string | null;
}

/** Two products that may be the same item; the busier seller comes first. */
export interface DuplicatePair {
  id: number;
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
  resolution: 'merged' | 'kept_both' | null;
  resolvedBy: string | null;
  products: [DuplicateSide, DuplicateSide];
}

/** The books: the chart of accounts and the entries 4VD writes from every document. */
export const ACCOUNT_CLASSES = ['asset', 'liability', 'equity', 'revenue', 'cost_of_sales', 'expense', 'other_income', 'other_expense'] as const;
export type AccountClass = (typeof ACCOUNT_CLASSES)[number];
export const CASH_FLOW_ACTIVITIES = ['operating', 'investing', 'financing'] as const;
export type CashFlowActivity = (typeof CASH_FLOW_ACTIVITIES)[number];
/** Classes whose balance normally sits on the debit side. */
export const DEBIT_CLASSES: readonly AccountClass[] = ['asset', 'cost_of_sales', 'expense', 'other_expense'];

export const ACCOUNT_LINK_KEYS = [
  'owner_in',
  'owner_out',
  'receivables',
  'vat_in',
  'stock',
  'payables',
  'vat_out',
  'revenue',
  'sales_returns',
  'cost_of_sales',
  'stock_corrections',
  'expense:rent',
  'expense:electricity',
  'expense:water',
  'expense:wages',
  'expense:supplies',
  'expense:repairs',
  'expense:taxes',
  'expense:other',
  'expense:internet',
  'expense:fuel',
  'expense:transport',
  'expense:cleaning',
  'expense:advertising',
  'expense:bank_fees',
  'expense:professional',
  'expense:insurance',
  'expense:office',
  'asset:furniture',
  'asset:equipment',
  'asset:vehicle',
  'asset:building',
  'asset:other',
  'withholding',
  'profit_tax',
  'profit_tax_payable',
  'retained_earnings',
] as const;
export type AccountLinkKey = (typeof ACCOUNT_LINK_KEYS)[number];

export interface LedgerAccount {
  id: number;
  number: string;
  name: string;
  accountClass: AccountClass;
  type: string;
  group: string;
  cashFlow: CashFlowActivity;
  archived: boolean;
  /** On the side the account normally sits. */
  balance: number;
  used: boolean;
  links: AccountLinkKey[];
}

export interface AccountInput {
  number: string;
  name: string;
  accountClass: AccountClass;
  type: string;
  group: string;
  cashFlow: CashFlowActivity;
}

export type EntryKind = 'auto' | 'manual' | 'reversal';

/** The page that shows the document behind an entry. */
export interface EntryTarget {
  page: 'document' | 'bill' | 'count' | 'customer' | 'product' | 'expenses' | 'sales';
  id?: number;
  search?: string;
}

export interface EntryParty {
  kind: 'supplier' | 'customer';
  id: number;
  name: string;
}

export interface EntryLine {
  accountId: number;
  accountNumber: string;
  accountName: string;
  debit: number;
  credit: number;
  party: EntryParty | null;
  memo: string | null;
}

export interface LedgerEntry {
  id: number;
  date: string;
  kind: EntryKind;
  /** What wrote it, e.g. "bill:12" or "checkout:i40"; null when written by hand. */
  source: string | null;
  description: string;
  /** e.g. "no_cost:2" or "no_vat". */
  warning: string | null;
  reversesId: number | null;
  reversed: boolean;
  createdBy: string | null;
  createdAt: string;
  total: number;
  lines: EntryLine[];
  target: EntryTarget | null;
}

export interface TrialBalanceRow {
  accountId: number;
  number: string;
  name: string;
  accountClass: AccountClass;
  group: string;
  /** Debits minus credits. */
  opening: number;
  debit: number;
  credit: number;
  closing: number;
}

export interface BooksWarning {
  warning: 'no_cost' | 'no_vat';
  entries: number;
  items: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  warnings: BooksWarning[];
}

export interface CardLine {
  entryId: number;
  date: string;
  kind: EntryKind;
  source: string | null;
  description: string;
  warning: string | null;
  party: EntryParty | null;
  memo: string | null;
  debit: number;
  credit: number;
  /** Debits minus credits after this line. */
  balance: number;
  correction: boolean;
  target: EntryTarget | null;
}

export interface AccountCard {
  account: LedgerAccount;
  opening: number;
  closing: number;
  debit: number;
  credit: number;
  lines: CardLine[];
}

export interface ManualEntryInput {
  date: string;
  description: string;
  lines: Array<{ accountId: number; debit: number; credit: number; supplierId?: number | null; customerId?: number | null; memo?: string | null }>;
}

export type OpeningLineKind = 'place' | 'stock' | 'supplier' | 'customer' | 'account';
export type OpeningSource = 'trefin' | 'counted' | 'statement' | 'stock' | 'typed';
export const TYPED_OPENING_SOURCES = ['counted', 'statement', 'trefin', 'typed'] as const;

/** One figure of what the shop has or owes when the books start. Amounts sit on the account's usual side. */
export interface OpeningLine {
  id: number;
  kind: OpeningLineKind;
  account: { id: number; number: string; name: string; accountClass: AccountClass };
  place: { id: number; kind: MoneyPlaceKind; name: string | null } | null;
  party: { id: number; name: string } | null;
  amount: number;
  trefinAmount: number | null;
  source: OpeningSource;
  note: string | null;
  confirmed: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
  editable: boolean;
  facts: { products?: number; noCost?: number; documents?: number };
}

export interface OpeningBalances {
  startDay: string | null;
  posted: { entryId: number; at: string; by: string | null } | null;
  trefin: { at: string; off: number; skipped: Array<{ what: string; amount: number }> } | null;
  lines: OpeningLine[];
  capital: { account: { id: number; number: string; name: string }; amount: number };
  debits: number;
  credits: number;
  confirmed: number;
  blockers: Array<'no_start' | 'unconfirmed' | 'posted' | 'empty'>;
}

export interface BooksSettings {
  startDay: string | null;
  links: Array<{ key: AccountLinkKey; accountId: number }>;
}

/** A record whose entries can be shown. */
export type EntrySource = 'bill' | 'payment' | 'expense' | 'return' | 'write_off' | 'count' | 'document' | 'sale' | 'move' | 'tab_payment';

/** First and last day of a period, both included, as yyyy-mm-dd. */
export interface BooksPeriod {
  from: string;
  to: string;
}

/* ---------- VAT ---------- */

export type VatItemKind = 'invoice' | 'till_day' | 'return' | 'bill' | 'credit';

/** One document as the VAT return sees it, with what it puts in each box. */
export interface VatItem {
  kind: VatItemKind;
  /** The document's id; a till day's date. */
  ref: string;
  date: string;
  number: string | null;
  party: string | null;
  nui: string | null;
  boxes: Partial<Record<number, number>>;
  /** A bill from an earlier month that was already filed, counted here instead ("2026-08"). */
  lateFrom?: string;
  count?: number;
}

export type VatCheckKind = 'no_nui' | 'vat_mismatch' | 'cash_over_limit' | 'order_without_bill' | 'previous_open' | 'books_differ';

export interface VatCheck {
  kind: VatCheckKind;
  to: string;
  facts: Record<string, string | number | null>;
}

export interface Over500Row {
  billId: number;
  date: string;
  supplier: string | null;
  nui: string | null;
  number: string | null;
  total: number;
  bank: number;
  cash: number;
  unpaid: number;
}

export interface VatMonth {
  /** "2026-09". */
  month: string;
  status: 'open' | 'filed';
  filedAt: string | null;
  filedBy: string | null;
  canFile: boolean;
  dueOn: string;
  boxes: Record<number, number>;
  outcome: 'pay' | 'carry' | 'nothing';
  carriedFrom: 'previous' | 'typed' | 'none';
  refundAsked: number;
  firstMonth: string | null;
  items: VatItem[];
  checks: VatCheck[];
  over500: Over500Row[];
}

export interface VatYearRow {
  month: string;
  status: 'open' | 'filed' | 'future';
  sales: number;
  purchases: number;
  equipment: number;
  charged: number;
  claimable: number;
  difference: number;
  carriedIn: number;
  carriedOut: number;
  toPay: number;
}

export interface WithholdingRow {
  billId: number;
  date: string;
  supplier: string | null;
  nui: string | null;
  number: string | null;
  type: string;
  rate: number;
  gross: number;
  withheld: number;
}

export type ThreadSubject = 'bill' | 'document' | 'entry';

export interface ThreadNote {
  id: number;
  author: string | null;
  side: 'question' | 'answer';
  body: string;
  createdAt: string;
}

export interface Thread {
  id: number | null;
  subject: string;
  status: 'open' | 'answered' | 'none';
  notes: ThreadNote[];
}

/* ---------- Money: where it is kept ---------- */

export type MoneyPlaceKind = 'till' | 'safe' | 'bank';

/** A place money is kept: a till, the safe, or a bank account. */
export interface MoneyPlace {
  id: number;
  kind: MoneyPlaceKind;
  /** Its own name, else its carwash's; null for the shop's till and an unnamed safe. */
  name: string | null;
  carwashId: number | null;
  bankName: string | null;
  iban: string | null;
  account: { id: number; number: string; name: string } | null;
  /** The safe or bank account a payment goes to when only "cash" or "bank" is said. */
  isDefault: boolean;
  /** A carwash's till is outside the books for now. */
  inBooks: boolean;
  openingBalance: number;
  openingDay: string | null;
  balance: number;
  archived: boolean;
  /** Bank statement lines still to match. */
  openLines: number;
  lastStatement: { lastDay: string | null; closingBalance: number | null } | null;
}

export type PlaceBookLineKind = 'takings' | 'carwash' | 'customer' | 'supplier' | 'group' | 'move' | 'customs' | 'count';

export interface PlaceBookLine {
  day: string;
  kind: PlaceBookLineKind;
  refId: number | null;
  /** Money in above zero, money out below; 0 on a count. */
  amount: number;
  balance: number;
  party: { id: number; name: string } | null;
  /** A move's other place; null with kind move: the owner. */
  otherPlace: { id: number; kind: MoneyPlaceKind; name: string | null } | null;
  detail: string | null;
  bills: number | null;
  billId: number | null;
  note: string | null;
  count: { counted: number; difference: number | null } | null;
}

export interface PlaceBook {
  place: MoneyPlace;
  from: string;
  to: string;
  opening: number;
  moneyIn: number;
  moneyOut: number;
  closing: number;
  lines: PlaceBookLine[];
}

export interface MoveInput {
  day: string;
  amount: number;
  /** Null: the owner put the money in. */
  fromPlaceId: number | null;
  /** Null: the owner took the money out. */
  toPlaceId: number | null;
  note: string | null;
}

export interface PlaceInput {
  kind: 'bank' | 'safe';
  name: string;
  bankName: string | null;
  iban: string | null;
  openingBalance: number;
  openingDay: string | null;
}

export interface PlaceChanges {
  name?: string;
  bankName?: string | null;
  iban?: string | null;
  openingBalance?: number;
  openingDay?: string | null;
  makeDefault?: boolean;
  archived?: boolean;
}

export interface PayBillsInput {
  supplierId: number;
  placeId: number;
  paidOn: string;
  note: string | null;
  bills: Array<{ billId: number; amount: number }>;
}

/** Something a customer still owes: an invoice, or (documentId null) the charges on no invoice. */
export interface OpenItem {
  documentId: number | null;
  number: string | null;
  date: string;
  dueDate: string | null;
  total: number;
  paid: number;
  left: number;
}

export interface ReceiveInput {
  amount: number;
  note: string | null;
  placeId?: number | null;
  day?: string | null;
  allocations?: Array<{ documentId: number | null; amount: number }>;
}

/* ---------- Bank statements ---------- */

export interface BankStatement {
  id: number;
  fileName: string;
  format: 'csv' | 'xlsx' | 'pdf';
  firstDay: string | null;
  lastDay: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  /** What 4VD says was in the account at the end of the statement's last day. */
  ourBalance: number | null;
  /** The statement's closing balance less 4VD's. */
  difference: number | null;
  linesRead: number;
  linesSkipped: number;
  uploadedBy: string | null;
  uploadedAt: string;
}

export type MatchReason =
  | { key: 'sameAmount' }
  | { key: 'sumOfBills'; count: number }
  | { key: 'nameInText'; name: string }
  | { key: 'numberInText'; number: string }
  | { key: 'daysApart'; days: number }
  | { key: 'rule'; contains: string }
  | { key: 'depositWords' };

export type LineAction =
  | { kind: 'payBills'; supplierId: number; bills: Array<{ billId: number; amount: number }> }
  | { kind: 'linkPayment'; paymentId: number }
  | { kind: 'linkGroup'; groupId: number }
  | { kind: 'receive'; customerId: number; allocations: Array<{ documentId: number | null; amount: number }> }
  | { kind: 'linkReceipt'; entryId: number }
  | { kind: 'linkMove'; moveId: number }
  | { kind: 'move'; otherPlaceId: number | null }
  | { kind: 'expense'; category: ExpenseCategory; supplierId: number | null };

export interface MatchSuggestion {
  action: LineAction;
  sure: boolean;
  reasons: MatchReason[];
  label: { supplier?: string | null; customer?: string; numbers?: string[]; placeId?: number | null; category?: string };
  ruleId: number | null;
}

export type BankLineStatus = 'open' | 'done' | 'skipped';
export type BankLineDoneKind = 'payment' | 'payment_group' | 'tab_payment' | 'move' | 'expense';

export interface BankLine {
  id: number;
  statementId: number;
  day: string;
  text: string;
  amount: number;
  balance: number | null;
  status: BankLineStatus;
  done: { kind: BankLineDoneKind; ref: number; madeRecord: boolean; by: string | null; at: string | null; billId: number | null; customerId: number | null } | null;
  ruleId: number | null;
  suggestions: MatchSuggestion[];
}

export type BankRuleAction = 'expense' | 'transfer' | 'owner';

export interface BankRule {
  id: number;
  placeId: number | null;
  contains: string;
  direction: 'in' | 'out';
  action: BankRuleAction;
  category: ExpenseCategory | null;
  supplierId: number | null;
  supplierName: string | null;
  otherPlaceId: number | null;
}

export type BankRuleInput = Omit<BankRule, 'id' | 'supplierName'>;

/** Which column of a statement file holds what, by position. */
export interface StatementLayout {
  headerRow: number;
  date: number;
  text: number;
  party: number | null;
  moneyIn: number | null;
  moneyOut: number | null;
  amount: number | null;
  balance: number | null;
  headers: string[];
}

export type StatementUpload =
  | { needsLayout: false; statement: BankStatement; added: number; skipped: number }
  | { needsLayout: true; preview: string[][]; guess: StatementLayout | null };

/** The Counter's set-up: the receipt's last line, the fiscal printer and the cash drawer. */
export interface CounterSettings {
  receiptFooter: string;
  printer: {
    /** Print a fiscal receipt for every sale, through the Windows app. */
    enabled: boolean;
    /** The printer's tax group (1-8) for each VAT rate; null when not set yet. */
    taxGroups: Record<'18' | '16' | '8' | '0', number | null>;
  };
  /** The drawer is wired to the printer, so 4VD can open it. */
  drawerConnected: boolean;
}

export type CounterEventKind = 'line_removed' | 'basket_cancelled' | 'drawer_opened' | 'print_failed' | 'reprinted' | 'x_report' | 'z_report';

export type CounterEventInput =
  | { kind: 'line_removed'; productId: number; quantity: number; amount: number; reason: string }
  | { kind: 'basket_cancelled'; quantity: number; amount: number; reason: string }
  | { kind: 'drawer_opened'; reason: string }
  | { kind: 'print_failed'; documentId?: number; reason: string | null }
  | { kind: 'reprinted'; documentId: number }
  | { kind: 'x_report' }
  | { kind: 'z_report' };

export interface CounterToday {
  lastZ: { at: string; by: string | null } | null;
  lastX: { at: string; by: string | null } | null;
}

/** A receipt found to give something back, with what is left to return on each line. */
export interface CounterReceipt {
  id: number;
  number: string;
  issuedAt: string;
  total: number;
  paidBy: 'cash' | 'card' | 'tab';
  fiscalReceiptNo: string | null;
  soldBy: string | null;
  lines: Array<{ saleId: number; productId: number; productName: string; quantity: number; pricePerUnit: number; saleDate: string; returnedQuantity: number; undone: boolean }>;
}

/** One person's counter over a period. */
export interface CounterPerson {
  user: { id: number; name: string };
  sales: number;
  sold: number;
  cash: number;
  card: number;
  tab: number;
  linesRemoved: number;
  removedAmount: number;
  basketsCancelled: number;
  cancelledAmount: number;
  refunds: number;
  refunded: number;
  drawerOpens: number;
  printFailures: number;
  reprints: number;
}

export interface CounterEvent {
  /** Below zero for a receipt deleted in TREFIN. */
  id: number;
  kind: CounterEventKind | 'trefin_deleted';
  user: { id: number; name: string } | null;
  product: { id: number; name: string } | null;
  quantity: number | null;
  amount: number | null;
  reason: string | null;
  document: { id: number; number: string } | null;
  at: string;
  /** What TREFIN kept about a receipt deleted there. */
  trefin: {
    deletedBy: string | null;
    number: string | null;
    kind: 'receipt' | 'invoice';
    soldOn: string;
    customer: string | null;
    lines: Array<{ name: string; quantity: number; total: number }>;
  } | null;
}

/* ---------- One VAT month next to TREFIN ---------- */

export type TrefinCompareStatus = 'same' | 'rounding' | 'differs';
export type TrefinCompareReason = 'only_trefin' | 'only_4vd' | 'other_month' | 'amount' | 'rate';

export interface TrefinCompareSide {
  ref: string;
  number: string | null;
  party: string | null;
  base: number;
  vat: number;
  gross: number;
  /** Sale lines behind a till day. */
  count: number | null;
  boxes: Partial<Record<number, number>>;
}

export interface TrefinCompareRow {
  key: string;
  kind: VatItemKind;
  date: string;
  status: TrefinCompareStatus;
  reason: TrefinCompareReason | null;
  facts: { month?: string; gross?: number; vat?: number; fourVdLines?: number; trefinLines?: number };
  fourVd: TrefinCompareSide | null;
  trefin: TrefinCompareSide | null;
  explained: { note: string; by: string | null; at: string } | null;
}

export interface TrefinCompareTotals {
  charged: number;
  claimable: number;
  toPay: number;
}

export interface TrefinCompare {
  month: string;
  loaded: { at: string; by: string | null; source: string | null } | null;
  boxes: Array<{ box: number; fourVd: number; trefin: number }>;
  totals: { fourVd: TrefinCompareTotals; trefin: TrefinCompareTotals };
  rows: TrefinCompareRow[];
  counts: { same: number; rounding: number; differs: number; explained: number };
}
