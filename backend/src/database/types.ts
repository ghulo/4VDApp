import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import type {
  ApprovalStatus,
  CountLineStatus,
  CountStatus,
  ReturnCondition,
  WriteOffReason,
} from '../constants/approvals.js';
import type { Language } from '../i18n/language.js';
import type { ExpenseCategory, ExpensePlace } from '../constants/expenses.js';

/**
 * TypeScript view of the tables created by the migrations in ./migrations.
 * Keep this file in sync whenever a migration changes a table.
 */

// pg returns NUMERIC/DECIMAL as strings to avoid losing precision. We accept
// numbers on insert/update and convert to numbers when mapping to API objects.
type Decimal = ColumnType<string, number | string, number | string>;
type CreatedAt = ColumnType<Date, Date | undefined, never>;
type UpdatedAt = ColumnType<Date, Date | undefined, Date>;

export const USER_ROLES = ['developer', 'admin', 'owner', 'employee', 'family'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface UsersTable {
  id: Generated<number>;
  email: string;
  /** Null for people who only sign in with Google. */
  password_hash: string | null;
  name: string;
  role: UserRole;
  is_active: Generated<boolean>;
  business_id: number;
  email_verified_at: Date | null;
  phone: string | null;
  avatar_media_id: string | null;
  theme: Generated<'light' | 'dark' | 'system'>;
  language: Generated<Language>;
  email_weekly_report: Generated<boolean>;
  last_login_at: Date | null;
  monthly_target: Decimal | null;
  commission_percent: Decimal | null;
  /** Push topic -> false when switched off; missing means on. */
  push_preferences: ColumnType<Record<string, boolean>, Record<string, boolean> | undefined, Record<string, boolean>>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
  deleted_at: Date | null;
}

export interface RefreshTokensTable {
  id: Generated<number>;
  user_id: number;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  /** Stays the same across refreshes: one per device. */
  session_id: Generated<string>;
  user_agent: string | null;
  ip: string | null;
  last_used_at: Date | null;
  created_at: CreatedAt;
}

export interface BusinessesTable {
  id: Generated<number>;
  name: string;
  address: string | null;
  phone: string | null;
  nui: string | null;
  currency: Generated<string>;
  time_zone: string | null;
  logo_media_id: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface MediaTable {
  id: Generated<string>;
  business_id: number | null;
  mime: string;
  bytes: Buffer;
  created_at: CreatedAt;
}

export const INVITE_ROLES = ['developer', 'admin', 'owner', 'employee', 'family'] as const;

export interface InvitesTable {
  id: Generated<number>;
  business_id: number;
  email: string;
  role: UserRole;
  token_hash: string;
  invited_by: number | null;
  language: Generated<Language>;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: CreatedAt;
}

export type AccountTokenPurpose = 'verify_email' | 'reset_password' | 'change_email';

export interface AccountTokensTable {
  id: Generated<number>;
  user_id: number;
  purpose: AccountTokenPurpose;
  token_hash: string;
  new_email: string | null;
  expires_at: Date;
  used_at: Date | null;
  created_at: CreatedAt;
}

export interface UserIdentitiesTable {
  id: Generated<number>;
  user_id: number;
  provider: 'google' | 'apple';
  subject: string;
  email: string | null;
  created_at: CreatedAt;
}

export interface EmailOutboxTable {
  id: Generated<number>;
  to_address: string;
  subject: string;
  html: string;
  text: string;
  attempts: Generated<number>;
  last_error: string | null;
  sent_at: Date | null;
  created_at: CreatedAt;
}

export interface CategoriesTable {
  id: Generated<number>;
  name: string;
  description: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
  deleted_at: Date | null;
}

export interface ProductsTable {
  id: Generated<number>;
  name: string;
  description: string | null;
  category_id: number;
  base_price: Decimal;
  cost_price: Decimal | null;
  image_url: string | null;
  sku: string | null;
  /** Scanned at the counter; set through its own endpoints, not the product form. */
  barcode: ColumnType<string | null, string | null | undefined, string | null>;
  is_active: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
  deleted_at: Date | null;
}

export interface InventoryTable {
  id: Generated<number>;
  product_id: number;
  quantity_on_hand: Generated<number>;
  reorder_level: Generated<number>;
  last_restocked_at: Date | null;
  updated_at: UpdatedAt;
}

export interface BulkPricingTiersTable {
  id: Generated<number>;
  product_id: number;
  quantity_min: number;
  price: Decimal;
  created_at: CreatedAt;
}

export interface SalesTable {
  id: Generated<number>;
  product_id: number;
  quantity_sold: number;
  price_per_unit: Decimal;
  /** Product cost when sold; null when it was unknown. */
  unit_cost: Decimal | null;
  // Computed by PostgreSQL (GENERATED ALWAYS AS ... STORED), never written.
  total_amount: ColumnType<string, never, never>;
  sold_by: number | null;
  /** The promotion that set the price, if any. */
  promotion_id: number | null;
  sale_date: ColumnType<Date, Date | undefined, Date>;
  notes: string | null;
  created_at: CreatedAt;
  /** Set when someone undid it (it stays, crossed out); cleared on restore. */
  undone_at: Date | null;
  undone_by: number | null;
  undo_note: string | null;
}

export interface StockAdjustmentsTable {
  id: Generated<number>;
  product_id: number;
  adjustment_quantity: number;
  reason: string;
  adjusted_by: number | null;
  adjustment_date: ColumnType<Date, Date | undefined, never>;
  notes: string | null;
  created_at: CreatedAt;
}

export interface ProductImagesTable {
  id: Generated<number>;
  product_id: number;
  image_url: string;
  is_primary: Generated<boolean>;
  uploaded_at: CreatedAt;
}

export interface NotificationsTable {
  id: Generated<number>;
  user_id: number;
  title: string;
  message: string;
  type: string | null;
  is_read: Generated<boolean>;
  /** Set once the background sender has pushed it (or decided not to). */
  pushed_at: Date | null;
  /** The request it's about, e.g. a write-off waiting for approval; deciding it marks the alert read. */
  subject_type: string | null;
  subject_id: number | null;
  created_at: CreatedAt;
}

export interface PushSubscriptionsTable {
  id: Generated<number>;
  user_id: number;
  kind: 'expo' | 'web';
  /** Expo push token, or Web Push endpoint URL. */
  token: string;
  keys: ColumnType<{ p256dh: string; auth: string } | null, { p256dh: string; auth: string } | null | undefined, { p256dh: string; auth: string } | null>;
  created_at: CreatedAt;
  last_used_at: Date | null;
}

export interface FavoritesTable {
  user_id: number;
  product_id: number;
  created_at: CreatedAt;
}

export interface ActivityLogTable {
  id: Generated<number>;
  user_id: number | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  summary: string;
  // pg serialises plain objects to JSON for us and parses JSONB on the way out.
  details: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null | undefined, never>;
  created_at: CreatedAt;
  /** Set when someone undid it (it stays, crossed out); cleared on restore. */
  undone_at: Date | null;
  undone_by: number | null;
  undo_note: string | null;
}

export interface PromotionsTable {
  id: Generated<number>;
  name: string;
  percent_off: Decimal;
  /** Exactly one of product_id and category_id is set. */
  product_id: number | null;
  category_id: number | null;
  starts_at: Date;
  /** End-exclusive. */
  ends_at: Date;
  created_by: number | null;
  created_at: CreatedAt;
  ended_early_at: Date | null;
}

/** A carwash the business runs. Archived ones keep their history but are no longer offered. */
export interface CarwashesTable {
  id: Generated<number>;
  name: string;
  /** Change left in its drawer every night; the cash check takes it off the count. */
  cash_float: ColumnType<string, number | string | undefined, number | string>;
  archived_at: Date | null;
  created_at: CreatedAt;
}

/** One carwash's takings for one day. `day` is a calendar date in shop time. */
export interface CarwashDaysTable {
  carwash_id: number;
  day: ColumnType<string, string, string>;
  carwash_amount: Decimal;
  change_amount: Decimal;
  recorded_by: number | null;
  updated_at: UpdatedAt;
}

/** One end-of-day count of a drawer. `day` is a calendar date in shop time. */
export interface CashCountsTable {
  id: Generated<number>;
  place: 'shop' | 'carwash';
  /** Which carwash; null for the shop. */
  carwash_id: number | null;
  day: ColumnType<string, string, string>;
  float_amount: Decimal;
  counted_amount: Decimal;
  note: string | null;
  counted_by: number | null;
  counted_at: ColumnType<Date, Date | undefined, Date>;
}

export interface RecurringExpensesTable {
  id: Generated<number>;
  amount: Decimal;
  category: ExpenseCategory;
  place: ExpensePlace;
  /** Which carwash, when `place` is 'carwash'. */
  carwash_id: number | null;
  note: string | null;
  day_of_month: number;
  last_filled_on: ColumnType<string, string, string>;
  stopped_at: Date | null;
  created_by: number | null;
  created_at: CreatedAt;
}

/** `day` is a calendar date in shop time. */
export interface ExpensesTable {
  id: Generated<number>;
  day: ColumnType<string, string, string>;
  amount: Decimal;
  category: ExpenseCategory;
  place: ExpensePlace;
  carwash_id: number | null;
  note: string | null;
  recurring_id: number | null;
  created_by: number | null;
  created_at: CreatedAt;
}

export interface CustomersTable {
  id: Generated<number>;
  name: string;
  kind: Generated<'person' | 'business'>;
  nui: string | null;
  phone: string | null;
  note: string | null;
  archived_at: Date | null;
  created_by: number | null;
  created_at: CreatedAt;
}

export interface TabEntriesTable {
  id: Generated<number>;
  customer_id: number;
  kind: 'charge' | 'payment';
  amount: Decimal;
  note: string | null;
  sale_id: number | null;
  occurred_at: ColumnType<Date, Date | undefined, Date>;
  created_by: number | null;
}

export interface SuppliersTable {
  id: Generated<number>;
  name: string;
  nui: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  archived_at: Date | null;
  created_at: CreatedAt;
}

export interface PurchaseOrdersTable {
  id: Generated<number>;
  supplier_id: number;
  status: Generated<'open' | 'received' | 'cancelled'>;
  note: string | null;
  created_by: number | null;
  created_at: CreatedAt;
  closed_by: number | null;
  closed_at: Date | null;
}

export interface PurchaseOrderLinesTable {
  id: Generated<number>;
  order_id: number;
  product_id: number;
  quantity: number;
  unit_cost: Decimal | null;
  received_quantity: number | null;
}

export interface ExpiryDatesTable {
  id: Generated<number>;
  product_id: number;
  quantity: number;
  expires_on: ColumnType<string, string, string>;
  note: string | null;
  order_line_id: number | null;
  created_by: number | null;
  created_at: CreatedAt;
  cleared_by: number | null;
  cleared_at: Date | null;
}

export interface SettingsTable {
  key: string;
  value: ColumnType<unknown, string, string>;
  updated_by: number | null;
  updated_at: Date | null;
}

/** Shared by every table whose rows wait for the owner's decision. */
interface ApprovalColumns {
  status: ApprovalStatus;
  requested_by: number | null;
  requested_at: ColumnType<Date, Date | undefined, Date>;
  decided_by: number | null;
  decided_at: Date | null;
  decision_note: string | null;
}

export interface ReturnsTable extends ApprovalColumns {
  id: Generated<number>;
  sale_id: number;
  quantity: number;
  refund_amount: Decimal;
  condition: ReturnCondition;
  notes: string | null;
  approval_reasons: ColumnType<string[], string[] | undefined, never>;
  /** Set when someone undid it (it stays, crossed out); cleared on restore. */
  undone_at: Date | null;
  undone_by: number | null;
  undo_note: string | null;
}

export interface WriteOffsTable extends ApprovalColumns {
  id: Generated<number>;
  product_id: number;
  quantity: number;
  reason: WriteOffReason;
  unit_cost: Decimal | null;
  return_id: number | null;
  notes: string | null;
  /** Set when someone undid it (it stays, crossed out); cleared on restore. */
  undone_at: Date | null;
  undone_by: number | null;
  undo_note: string | null;
}

export interface StockCountsTable {
  id: Generated<number>;
  category_id: number | null;
  status: CountStatus;
  started_by: number | null;
  started_at: ColumnType<Date, Date | undefined, never>;
  submitted_by: number | null;
  submitted_at: Date | null;
  closed_at: Date | null;
}

export interface StockCountLinesTable {
  id: Generated<number>;
  count_id: number;
  product_id: number;
  counted_quantity: number;
  expected_quantity: number;
  unit_cost: Decimal | null;
  counted_by: number | null;
  counted_at: ColumnType<Date, Date | undefined, Date>;
  status: CountLineStatus | null;
  decided_by: number | null;
  decided_at: Date | null;
  decision_note: string | null;
  /** Set when someone undid it (it stays, crossed out); cleared on restore. */
  undone_at: Date | null;
  undone_by: number | null;
  undo_note: string | null;
}

/** Read-only view: sales, plus approved returns as negative rows. */
export interface SalesLedgerView {
  sale_id: number;
  return_id: number | null;
  product_id: number;
  sold_by: number | null;
  occurred_at: Date;
  units: number;
  revenue: string;
  unit_cost: string | null;
  cost: string | null;
}

export interface Database {
  users: UsersTable;
  refresh_tokens: RefreshTokensTable;
  categories: CategoriesTable;
  products: ProductsTable;
  inventory: InventoryTable;
  bulk_pricing_tiers: BulkPricingTiersTable;
  sales: SalesTable;
  stock_adjustments: StockAdjustmentsTable;
  product_images: ProductImagesTable;
  notifications: NotificationsTable;
  favorites: FavoritesTable;
  activity_log: ActivityLogTable;
  settings: SettingsTable;
  promotions: PromotionsTable;
  push_subscriptions: PushSubscriptionsTable;
  businesses: BusinessesTable;
  media: MediaTable;
  invites: InvitesTable;
  account_tokens: AccountTokensTable;
  user_identities: UserIdentitiesTable;
  email_outbox: EmailOutboxTable;
  returns: ReturnsTable;
  write_offs: WriteOffsTable;
  stock_counts: StockCountsTable;
  stock_count_lines: StockCountLinesTable;
  carwashes: CarwashesTable;
  carwash_days: CarwashDaysTable;
  cash_counts: CashCountsTable;
  recurring_expenses: RecurringExpensesTable;
  expenses: ExpensesTable;
  customers: CustomersTable;
  tab_entries: TabEntriesTable;
  suppliers: SuppliersTable;
  purchase_orders: PurchaseOrdersTable;
  purchase_order_lines: PurchaseOrderLinesTable;
  expiry_dates: ExpiryDatesTable;
  sales_ledger: SalesLedgerView;
}

export type UserRow = Selectable<UsersTable>;
export type NewUserRow = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type CategoryRow = Selectable<CategoriesTable>;
export type ProductRow = Selectable<ProductsTable>;
export type InventoryRow = Selectable<InventoryTable>;
export type BulkPricingTierRow = Selectable<BulkPricingTiersTable>;
export type SaleRow = Selectable<SalesTable>;
export type NotificationRow = Selectable<NotificationsTable>;
export type ActivityLogRow = Selectable<ActivityLogTable>;
