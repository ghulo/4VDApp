import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import type {
  ApprovalStatus,
  CountLineStatus,
  CountStatus,
  ReturnCondition,
  WriteOffReason,
} from '../constants/approvals.js';
import type { Language } from '../i18n/language.js';
import type { BillKind, BillLineKind, CustomsPaidMethod, WithholdingType } from '../constants/bills.js';
import type { ExpensePlace } from '../constants/expenses.js';
import type { AccountClass, CashFlowActivity } from '../constants/chartOfAccounts.js';

/**
 * TypeScript view of the tables created by the migrations in ./migrations.
 * Keep this file in sync whenever a migration changes a table.
 */

// pg returns NUMERIC/DECIMAL as strings to avoid losing precision. We accept
// numbers on insert/update and convert to numbers when mapping to API objects.
type Decimal = ColumnType<string, number | string, number | string>;
type CreatedAt = ColumnType<Date, Date | undefined, never>;
type UpdatedAt = ColumnType<Date, Date | undefined, Date>;
/** A nullable column that inserts may leave out. */
type Optional<T> = ColumnType<T | null, T | null | undefined, T | null>;

/** Roles a person holds inside a business (users, memberships, invites). main_admin is the top one. */
export const STORED_ROLES = ['main_admin', 'admin', 'owner', 'employee', 'family', 'accountant'] as const;
export type StoredRole = (typeof STORED_ROLES)[number];
/** Roles a request can act as: the stored ones, plus developer for 4VD's own staff (users.is_platform_developer). */
export const USER_ROLES = ['developer', ...STORED_ROLES] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface UsersTable {
  id: Generated<number>;
  email: string;
  /** Null for people who only sign in with Google. */
  password_hash: string | null;
  name: string;
  role: StoredRole;
  is_active: Generated<boolean>;
  business_id: number;
  /** 4VD's own staff: opens every business. Set by hand on the database only (a trigger refuses the app). */
  is_platform_developer: Generated<boolean>;
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
  /** bcrypt of the Counter PIN; null when none is set. */
  pin_hash: Generated<string | null>;
  pin_set_at: Generated<Date | null>;
  /** A password sign-in clears wrong-PIN attempts before this moment. */
  pin_cleared_at: Generated<Date | null>;
  /** Two-step sign-in: the encrypted authenticator secret; null while it is off. */
  totp_secret: Generated<string | null>;
  /** A secret being set up, until the first code confirms it. */
  totp_pending: Generated<string | null>;
  totp_enabled_at: Generated<Date | null>;
  /** The 30-second step of the last code used (a code works once). */
  totp_last_step: ColumnType<string | null, string | number | null | undefined, string | number | null>;
  /** SHA-256 hashes of the unused backup codes. */
  totp_recovery: Generated<string[]>;
  /** A manager asked them to set two-step sign-in up again: no session until they do. */
  two_step_required: Generated<boolean>;
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
  /** One PC: new at a password sign-in, kept when someone takes over with a PIN. */
  device_id: Generated<string | null>;
  /** The business this session works in (the business picker); null = the person's home business. */
  business_id: number | null;
  created_at: CreatedAt;
}

export interface OfflineShortfallsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  product_id: number;
  sale_id: number | null;
  short_by: number;
  sold_by: number | null;
  sold_at: Date;
  created_at: Generated<Date>;
}

export interface PinAttemptsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  user_id: number | null;
  device_id: string;
  purpose: 'switch' | 'rabat' | 'pay_later';
  ok: boolean;
  at: CreatedAt;
}

export interface RabatApprovalsTable {
  business_id: Generated<number>;
  id: string;
  approved_by: number;
  asked_by: number;
  basket_id: string;
  /** A bigger rabat (`percent`), or a pay-later sale for `customer_id` up to `amount`. */
  purpose: Generated<'rabat' | 'pay_later'>;
  percent: ColumnType<string | null, number | null | undefined, never>;
  customer_id: ColumnType<number | null, number | null | undefined, never>;
  amount: ColumnType<string | null, number | null | undefined, never>;
  expires_at: Date;
  used_at: Date | null;
  created_at: CreatedAt;
}

export type LegalForm = 'company' | 'individual';

export interface BusinessesTable {
  id: Generated<number>;
  tenant_id: number | null;
  name: string;
  address: string | null;
  phone: string | null;
  nui: string | null;
  currency: Generated<string>;
  time_zone: string | null;
  logo_media_id: string | null;
  stamp_media_id: string | null;
  signature_media_id: string | null;
  bank_name: string | null;
  iban: string | null;
  /** Printed at the bottom of every invoice: thanks, return rules. */
  invoice_note: string | null;
  /** 'company' files the CD (profit tax); 'individual' (B.I.) files the PD (personal income tax). */
  legal_form: Generated<LegalForm>;
  /** The part after the + in its bill address, bills+<short>@4vd.app (utils/shortName.ts). */
  short_name: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

/** Who pays for 4VD; one tenant has one or more businesses. */
export interface TenantsTable {
  id: Generated<number>;
  name: string;
  created_at: CreatedAt;
}

/** Who works for which business, and as what. Until sign-in reads it, a trigger copies users.role here. */
export interface MembershipsTable {
  id: Generated<number>;
  user_id: number;
  business_id: number;
  role: StoredRole;
  is_active: Generated<boolean>;
  /** Taken off a business that is not their home (the row stays for their name on past work). */
  removed_at: Generated<Date | null>;
  created_at: CreatedAt;
}

export type AttachmentEntity = 'bill' | 'expense' | 'document' | 'offer' | 'order' | 'customer' | 'supplier' | 'entry';

/** A file (PDF or photo) kept on a record; removed ones wait in the recycle bin. */
export interface AttachmentsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  entity_type: AttachmentEntity;
  entity_id: number;
  media_id: string;
  name: string;
  mime: string;
  size: number;
  added_by: number | null;
  added_at: CreatedAt;
  removed_at: Date | null;
  removed_by: number | null;
}

export interface MediaTable {
  id: Generated<string>;
  business_id: number | null;
  mime: string;
  bytes: Buffer;
  created_at: CreatedAt;
}

export interface InvitesTable {
  id: Generated<number>;
  business_id: number;
  email: string;
  role: StoredRole;
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

export interface PasskeysTable {
  id: Generated<number>;
  user_id: number;
  credential_id: string;
  public_key: Uint8Array;
  counter: ColumnType<string, string | number | undefined, string | number>;
  transports: ColumnType<string[], string[] | undefined, string[]>;
  backed_up: ColumnType<boolean, boolean | undefined, boolean>;
  aaguid: string | null;
  name: string;
  created_at: CreatedAt;
  last_used_at: Date | null;
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
  business_id: Generated<number>;
  id: Generated<number>;
  name: string;
  description: string | null;
  /** Days before a best-before date its products count as short-dated; null: the shop's. */
  short_dated_days: ColumnType<number | null, number | null | undefined, number | null>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
  deleted_at: Date | null;
}

/** Sold by the piece, or measured: by the kilo (weighed), the litre, the metre or the square metre. */
export type ProductUnit = 'piece' | 'kg' | 'l' | 'm' | 'm2';

export interface ProductsTable {
  business_id: Generated<number>;
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
  /** VAT percent included in the price: 18, 16, 8 or 0. */
  vat_rate: Generated<number>;
  /** Exempt from VAT (a 0% rate that goes in the VAT return's exempt box). */
  vat_exempt: Generated<boolean>;
  /** Where it comes from (ISO code); starts from the barcode's prefix. */
  origin_country: string | null;
  /** What a business pays, with VAT; null: the shelf price. */
  wholesale_price: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  /** Sold by the piece or by the kilo (prices per kg, quantities to the gram). */
  unit: Generated<ProductUnit>;
  /** The number the shop scale prints in its labels. */
  scale_plu: ColumnType<number | null, number | null | undefined, number | null>;
  /** Has a best-before date: the date is asked for when it comes in. */
  has_best_before: Generated<boolean>;
  /** Days before its best-before date it counts as short-dated; null: its category's, else the shop's. */
  short_dated_days: ColumnType<number | null, number | null | undefined, number | null>;
  is_active: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
  deleted_at: Date | null;
  /** Serial numbers are recorded and asked for at the sale. */
  has_serials: Generated<boolean>;
  /** Months of warranty the shop gives; null when none. */
  warranty_months: ColumnType<number | null, number | null | undefined, number | null>;
}

export interface InventoryTable {
  business_id: Generated<number>;
  id: Generated<number>;
  product_id: number;
  quantity_on_hand: Generated<number>;
  reorder_level: Generated<number>;
  last_restocked_at: Date | null;
  updated_at: UpdatedAt;
}

export interface BulkPricingTiersTable {
  business_id: Generated<number>;
  id: Generated<number>;
  product_id: number;
  quantity_min: number;
  price: Decimal;
  created_at: CreatedAt;
}

export interface SalesTable {
  business_id: Generated<number>;
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
  /** Rabat given at the counter, in percent; null when none. */
  discount_percent: Decimal | null;
  /** The unit price before that rabat (after bulk prices and promotions). */
  price_before_discount: Decimal | null;
  sale_date: ColumnType<Date, Date | undefined, Date>;
  notes: string | null;
  created_at: CreatedAt;
  /** Set when someone undid it (it stays, crossed out); cleared on restore. */
  undone_at: Date | null;
  undone_by: number | null;
  undo_note: string | null;
  /** The old till's receipt number on sales imported from it; its lines are one checkout. */
  receipt_no: ColumnType<string | null, string | null | undefined, string | null>;
  /** Sold at the wholesale price (the customer pays it, or it was switched on for the sale). */
  wholesale: Generated<boolean>;
  /** Sold from this short-dated batch (an expiry date) at the short-dated price. */
  expiry_date_id: ColumnType<number | null, number | null | undefined, number | null>;
  /** The short-dated discount off the shelf price, in percent. */
  short_dated_percent: ColumnType<string | null, number | string | null | undefined, number | string | null>;
}

/** Two products that look like the same item, for someone to merge or keep apart. */
/** A product's other barcodes; `products.barcode` is its main one. */
export interface ProductBarcodesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  product_id: number;
  barcode: string;
  added_by: number | null;
  /** A pack barcode: scanning it adds this many pieces. Null: one piece. */
  pack_size: ColumnType<number | null, number | null | undefined, number | null>;
  created_at: CreatedAt;
}

export type StockDocumentDirection = 'in' | 'out';
export type StockDocumentReason = 'found' | 'received_free' | 'own_use' | 'given_away' | 'other';

/** Where stock is kept: the shop floor, a storeroom. */
export interface StockLocationsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  name: string;
  /** The till sells from here. Exactly one. */
  sells_here: Generated<boolean>;
  /** Goods coming in go here unless another is picked. Exactly one. */
  receives_here: Generated<boolean>;
  created_at: CreatedAt;
  removed_at: Date | null;
}

/** How much of a product's total is in each location. */
export interface LocationStockTable {
  business_id: Generated<number>;
  location_id: number;
  product_id: number;
  quantity: Generated<number>;
  /** Below this on the selling floor, it wants refilling from storage. */
  shelf_minimum: ColumnType<number | null, number | null | undefined, number | null>;
  updated_at: UpdatedAt;
}

/** Stock moved from one location to another (LV-). Never in the books. */
export interface StockMovesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  number: string;
  from_location_id: number;
  to_location_id: number;
  /** Read through to_char, so kept as text. */
  day: string;
  note: string | null;
  created_by: number | null;
  created_at: CreatedAt;
  voided_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  voided_by: ColumnType<number | null, number | null | undefined, number | null>;
}

export interface StockMoveLinesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  move_id: number;
  product_id: number;
  quantity: number;
}

export interface StockDocumentsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  number: string;
  direction: StockDocumentDirection;
  reason: StockDocumentReason;
  /** Read through to_char, so kept as text. */
  day: string;
  note: string | null;
  created_by: number | null;
  created_at: CreatedAt;
  voided_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  voided_by: ColumnType<number | null, number | null | undefined, number | null>;
  /** Where the stock moved (stock_locations); null before locations existed. */
  location_id: ColumnType<number | null, number | null | undefined, number | null>;
  /** Project tag (projects); null when none. */
  project_id: ColumnType<number | null, number | null | undefined, number | null>;
}

export interface StockDocumentLinesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  document_id: number;
  product_id: number;
  quantity: ColumnType<number, number, number>;
  unit_cost: ColumnType<string | null, number | null, number | null>;
}

export type AssetCategory = 'furniture' | 'equipment' | 'vehicle' | 'building' | 'land' | 'intangible' | 'other';
export type AssetDisposal = 'sold' | 'scrapped' | 'returned';

export interface FixedAssetsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  name: string;
  code: string | null;
  category: AssetCategory;
  /** Read through to_char, so kept as text. */
  bought_on: string;
  in_use_from: string;
  cost: ColumnType<string, number, number>;
  residual: ColumnType<string, number | undefined, number>;
  rate: ColumnType<string, number, number>;
  opening_depreciated: ColumnType<string, number | undefined, number>;
  bill_line_id: number | null;
  place: 'shop' | 'carwash';
  note: string | null;
  filled_through: ColumnType<string | null, string | null | undefined, string | null>;
  disposed_on: ColumnType<string | null, string | null | undefined, string | null>;
  disposal: ColumnType<AssetDisposal | null, AssetDisposal | null | undefined, AssetDisposal | null>;
  sale_net: ColumnType<string | null, number | null | undefined, number | null>;
  sale_vat_rate: ColumnType<number | null, number | null | undefined, number | null>;
  sale_vat: ColumnType<string | null, number | null | undefined, number | null>;
  buyer_name: ColumnType<string | null, string | null | undefined, string | null>;
  buyer_nui: ColumnType<string | null, string | null | undefined, string | null>;
  customer_id: ColumnType<number | null, number | null | undefined, number | null>;
  paid_place_id: ColumnType<number | null, number | null | undefined, number | null>;
  credit_bill_id: ColumnType<number | null, number | null | undefined, number | null>;
  disposal_note: ColumnType<string | null, string | null | undefined, string | null>;
  created_by: number | null;
  created_at: CreatedAt;
  voided_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  voided_by: ColumnType<number | null, number | null | undefined, number | null>;
}

export interface DepreciationMonthsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  /** The month's first day, read through to_char. */
  month: string;
}

export interface DepreciationLinesTable {
  business_id: Generated<number>;
  month_id: number;
  asset_id: number;
  amount: ColumnType<string, number, number>;
}

export interface ProductDuplicateFlagsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  product_id: number;
  other_product_id: number;
  /** 'identical name' or 'very similar name'. */
  reason: string;
  similarity: Decimal | null;
  created_at: CreatedAt;
  resolved_at: Date | null;
  resolved_by: number | null;
  resolution: 'merged' | 'kept_both' | null;
}

export interface StockAdjustmentsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  product_id: number;
  adjustment_quantity: number;
  reason: string;
  adjusted_by: number | null;
  adjustment_date: ColumnType<Date, Date | undefined, never>;
  notes: string | null;
  created_at: CreatedAt;
  /** Where the stock moved (stock_locations); null before locations existed. */
  location_id: ColumnType<number | null, number | null | undefined, number | null>;
}

export interface ProductImagesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  product_id: number;
  image_url: string;
  is_primary: Generated<boolean>;
  uploaded_at: CreatedAt;
}

export interface NotificationsTable {
  business_id: Generated<number>;
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
  /** The page a tap opens; null opens the alerts. */
  link: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: CreatedAt;
}

export interface PushSubscriptionsTable {
  id: Generated<number>;
  user_id: number;
  kind: 'expo' | 'web';
  /** Expo push token, or Web Push endpoint URL. */
  token: string;
  keys: ColumnType<{ p256dh: string; auth: string } | null, { p256dh: string; auth: string } | null | undefined, { p256dh: string; auth: string } | null>;
  /** Which app turned alerts on here; someone with a dashboard device gets alerts only there. */
  app: ColumnType<'dashboard' | 'team', 'dashboard' | 'team' | undefined, 'dashboard' | 'team'>;
  created_at: CreatedAt;
  last_used_at: Date | null;
}

export interface FavoritesTable {
  business_id: Generated<number>;
  user_id: number;
  product_id: number;
  created_at: CreatedAt;
}

export interface ActivityLogTable {
  business_id: Generated<number>;
  id: Generated<number>;
  user_id: number | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  summary: string;
  /** What it says as a sentence key and values (see i18n/activityText); null on older entries. */
  summary_say: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null | undefined, never>;
  // pg serialises plain objects to JSON for us and parses JSONB on the way out.
  details: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null | undefined, never>;
  created_at: CreatedAt;
  /** Set when someone undid it (it stays, crossed out); cleared on restore. */
  undone_at: Date | null;
  undone_by: number | null;
  undo_note: string | null;
}

export interface PromotionsTable {
  business_id: Generated<number>;
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
  business_id: Generated<number>;
  id: Generated<number>;
  name: string;
  /** Change left in its drawer every night; the cash check takes it off the count. */
  cash_float: ColumnType<string, number | string | undefined, number | string>;
  archived_at: Date | null;
  created_at: CreatedAt;
}

/** One carwash's takings for one day. `day` is a calendar date in shop time. */
export interface CarwashDaysTable {
  business_id: Generated<number>;
  carwash_id: number;
  day: ColumnType<string, string, string>;
  carwash_amount: Decimal;
  change_amount: Decimal;
  recorded_by: number | null;
  updated_at: UpdatedAt;
}

/** One end-of-day count of a drawer. `day` is a calendar date in shop time. */
export interface CashOpeningsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  place: 'shop' | 'carwash';
  /** Which carwash; null for the shop. */
  carwash_id: number | null;
  day: ColumnType<string, string, string>;
  amount: Decimal;
  opened_by: number | null;
  opened_at: ColumnType<Date, Date | undefined, Date>;
}

export interface CashCountsTable {
  business_id: Generated<number>;
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
  /** Who said they looked at this count's difference; cleared when the drawer is counted again. */
  checked_by: number | null;
  checked_at: Date | null;
}

export interface AssistantChatsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  user_id: number;
  title: string;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface AssistantMessagesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  chat_id: number;
  role: 'user' | 'assistant';
  content: string;
  extras: ColumnType<unknown | null, string | null, string | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
}

/** A bill made by itself every month (rent, internet, power), from the bill form's own input. */
export interface BillRepeatsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  supplier_id: number | null;
  template: ColumnType<unknown, string, string>;
  amount: Decimal;
  category: string | null;
  place: Generated<ExpensePlace>;
  carwash_id: number | null;
  note: string | null;
  day_of_month: number;
  last_filled_on: ColumnType<string, string, string>;
  stopped_at: Date | null;
  created_by: number | null;
  created_at: CreatedAt;
}

/** One line of a supplier bill: a product into stock, a cost with a category, or equipment. */
export interface BillLinesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  bill_id: number;
  position: number;
  kind: BillLineKind;
  product_id: number | null;
  quantity: number | null;
  unit_price: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  category: string | null;
  description: string | null;
  vat_rate: number;
  vat_exempt: Generated<boolean>;
  net: Decimal;
  vat: Decimal;
  landed: Decimal;
  spread: Generated<boolean>;
  self_vat: ColumnType<string, number | string | undefined, number | string>;
  order_line_id: number | null;
}

/** A day a manager said had no expenses, so the end-of-day list can close. */
export interface NoExpenseDaysTable {
  business_id: Generated<number>;
  day: ColumnType<string, string, string>;
  marked_by: number | null;
  marked_at: CreatedAt;
}

export interface CustomersTable {
  business_id: Generated<number>;
  id: Generated<number>;
  name: string;
  kind: Generated<'person' | 'business'>;
  nui: string | null;
  phone: string | null;
  note: string | null;
  /** The partner code it had in TREFIN. */
  external_code: ColumnType<string | null, string | null | undefined, string | null>;
  address: Optional<string>;
  city: Optional<string>;
  /** The business registration no. (NRB). */
  business_no: Optional<string>;
  fiscal_no: Optional<string>;
  vat_no: Optional<string>;
  iban: Optional<string>;
  contact_person: Optional<string>;
  mobile: Optional<string>;
  /** The most they may owe on their tab, and their usual discount, as TREFIN had them. */
  credit_limit: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  discount_percent: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  /** The owner lets them take goods and pay later, up to `credit_limit` (none: no cap). */
  pay_later: Generated<boolean>;
  /** They pay the wholesale price instead of the shelf price (step 9). */
  pays_wholesale: Generated<boolean>;
  /** Step 15: the portal is on for this customer, they may order there, the least an order may be, and the categories they see (null: all). */
  portal_enabled: Generated<boolean>;
  portal_can_order: Generated<boolean>;
  portal_min_order: ColumnType<string | null, number | null | undefined, number | null>;
  portal_categories: ColumnType<number[] | null, number[] | null | undefined, number[] | null>;
  /** The bonus they earn on a year's purchases, in percent; null: none. */
  bonus_percent: ColumnType<string | null, number | null | undefined, number | null>;
  archived_at: Date | null;
  created_by: number | null;
  created_at: CreatedAt;
}

/** A charge adds to what's owed; a payment (money in) or a refund (a return) takes it off. */
/** credit: what they owe goes down with no money moving (an offset against their bills, or a bonus). */
export type TabEntryKind = 'charge' | 'payment' | 'refund' | 'credit';

export type OfferStatus = 'open' | 'sold' | 'declined';

/** A price quote made in 4VD; TREFIN's are in `trefin_offers`. */
export interface OffersTable {
  business_id: Generated<number>;
  id: Generated<number>;
  number: string;
  customer_id: number | null;
  /** A buyer who isn't in the customer list: just a typed name and phone. */
  party_name: string | null;
  party_phone: string | null;
  note: string | null;
  /** "YYYY-MM-DD". */
  valid_until: ColumnType<string, string, string>;
  status: Generated<OfferStatus>;
  total: Decimal;
  /** The invoice the customer's yes became. */
  sale_document_id: number | null;
  decided_at: Date | null;
  created_by: number | null;
  created_at: CreatedAt;
}

export interface OfferLinesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  offer_id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  /** The price offered for one, VAT included; `shelf_price` is what it cost on the shelf that day. */
  unit_price: Decimal;
  shelf_price: Decimal;
  total: Decimal;
}

export type DeliveryStatus = 'waiting' | 'on_the_way' | 'delivered';

/** A sale taken to the customer's door. */
export interface CustomerDeliveriesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  document_id: number;
  customer_id: number | null;
  name: string;
  phone: string | null;
  address: string;
  /** "YYYY-MM-DD"; the window is "HH:MM" or none. */
  deliver_on: ColumnType<string, string, string>;
  time_from: string | null;
  time_to: string | null;
  note: string | null;
  total: Decimal;
  /** What is still to be paid at the door. */
  to_collect: Decimal;
  status: Generated<DeliveryStatus>;
  taken_by: number | null;
  taken_at: Date | null;
  delivered_by: number | null;
  delivered_at: Date | null;
  collected: Decimal | null;
  payment_entry_id: number | null;
  /** Why the last try didn't reach them. */
  last_failure: string | null;
  failures: Generated<number>;
  created_by: number | null;
  created_at: CreatedAt;
}

export interface TabEntriesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  customer_id: number;
  kind: TabEntryKind;
  amount: Decimal;
  note: string | null;
  sale_id: number | null;
  /** Set on a refund: the return it came from. */
  return_id: number | null;
  occurred_at: ColumnType<Date, Date | undefined, Date>;
  created_by: number | null;
  /** On a payment: where the money arrived (null: the shop's till). */
  place_id: ColumnType<number | null, number | null | undefined, number | null>;
  /** A balance from before the books start, brought over at launch: out of the books. */
  brought_over: Generated<boolean>;
  /** On a credit: the offset or bonus it came from. */
  offset_id: ColumnType<number | null, number | null | undefined, number | null>;
  bonus_id: ColumnType<number | null, number | null | undefined, number | null>;
}

export interface SuppliersTable {
  business_id: Generated<number>;
  id: Generated<number>;
  name: string;
  nui: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  /** The partner code it had in TREFIN. */
  external_code: ColumnType<string | null, string | null | undefined, string | null>;
  address: Optional<string>;
  city: Optional<string>;
  /** The business registration no. (NRB). */
  business_no: Optional<string>;
  fiscal_no: Optional<string>;
  vat_no: Optional<string>;
  iban: Optional<string>;
  contact_person: Optional<string>;
  mobile: Optional<string>;
  /** A supplier from another country: its bills are imports, handled by 4VD (customs VAT, VAT charged to yourself). */
  abroad: Generated<boolean>;
  /** Remembered from its last bill, to fill in the next one. */
  usual_kind: BillLineKind | null;
  usual_category: string | null;
  usual_vat_rate: number | null;
  usual_vat_exempt: Generated<boolean>;
  withholding_type: WithholdingType | null;
  archived_at: Date | null;
  created_at: CreatedAt;
}

export interface PurchaseOrdersTable {
  business_id: Generated<number>;
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
  business_id: Generated<number>;
  id: Generated<number>;
  order_id: number;
  product_id: number;
  quantity: number;
  unit_cost: Decimal | null;
  received_quantity: number | null;
}

export interface ExpiryDatesTable {
  business_id: Generated<number>;
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
  /** The write-off that took what was left off the shelf. */
  write_off_id: ColumnType<number | null, number | null | undefined, number | null>;
}

export interface SettingsTable {
  business_id: Generated<number>;
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
  business_id: Generated<number>;
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
  business_id: Generated<number>;
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
  /** Where the stock moved (stock_locations); null before locations existed. */
  location_id: ColumnType<number | null, number | null | undefined, number | null>;
  /** Project tag (projects); null when none. */
  project_id: ColumnType<number | null, number | null | undefined, number | null>;
}

export interface StockCountsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  category_id: number | null;
  status: CountStatus;
  started_by: number | null;
  started_at: ColumnType<Date, Date | undefined, never>;
  submitted_by: number | null;
  submitted_at: Date | null;
  closed_at: Date | null;
  /** Where the stock moved (stock_locations); null before locations existed. */
  location_id: ColumnType<number | null, number | null | undefined, number | null>;
}

export interface StockCountLinesTable {
  business_id: Generated<number>;
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
/**
 * Everyone who works for the current business (view, migration 085): a users
 * row with role and is_active from their membership in this business.
 */
export type PeopleView = UsersTable;

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

export interface SupplierBillsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  /** Null for an expense paid to nobody in particular. */
  supplier_id: number | null;
  /** The purchase order it bills, if it came from one. */
  order_id: number | null;
  /** The supplier's own invoice number. */
  number: string | null;
  issued_on: ColumnType<string, string, string>;
  due_on: ColumnType<string | null, string | null, string | null>;
  amount: Decimal;
  note: string | null;
  photo_media_id: string | null;
  created_by: number | null;
  created_at: CreatedAt;
  voided_at: Date | null;
  voided_by: number | null;
  void_note: string | null;
  /** The VAT on the bill, to claim back; null when nobody entered it. */
  vat_amount: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  /** 'credit': a return or credit against the bill `credit_for_id`. */
  kind: Generated<BillKind>;
  credit_for_id: number | null;
  /** A return: its product lines' units went back out of stock. */
  returns_stock: Generated<boolean>;
  /** Whether the paper's prices include VAT. */
  prices_include_vat: Generated<boolean>;
  /** The supplier was abroad when it was saved: an import. */
  abroad: Generated<boolean>;
  customs_vat: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  customs_duty: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  customs_paid_method: CustomsPaidMethod | null;
  withholding_type: WithholdingType | null;
  /** Tax held back for ATK: taken off `amount`, which is what the supplier is owed. */
  withheld: ColumnType<string, number | string | undefined, number | string>;
  /** An expense: paid when it was entered. */
  paid_now: Generated<boolean>;
  place: Generated<ExpensePlace>;
  carwash_id: number | null;
  repeat_id: number | null;
  /** The VAT month it counts in when its own month was already filed; null: its own month. */
  vat_month: ColumnType<string | null, string | null | undefined, string | null>;
  /** An open bill from before the books start, brought over at launch: out of the books and the VAT return. */
  brought_over: Generated<boolean>;
  /** "<database>/<document id>": a bill from TREFIN's history, only to look at (never owed, posted, counted for VAT or changed). */
  trefin_ref: Optional<string>;
  /** Where its products came in (stock_locations). */
  location_id: ColumnType<number | null, number | null | undefined, number | null>;
  /** Project tag (projects); null when none. */
  project_id: ColumnType<number | null, number | null | undefined, number | null>;
}

export const BILL_SCAN_STATUSES = ['waiting', 'confirmed', 'discarded'] as const;
export type BillScanStatus = (typeof BILL_SCAN_STATUSES)[number];

export interface BillScansTable {
  business_id: Generated<number>;
  id: Generated<number>;
  status: ColumnType<BillScanStatus, BillScanStatus | undefined, BillScanStatus>;
  media_ids: string[];
  /** What the AI read off the bill (BillReading). */
  reading: ColumnType<unknown, string, string>;
  scanned_by: number | null;
  scanned_at: CreatedAt;
  decided_by: number | null;
  decided_at: Date | null;
  bill_id: number | null;
  order_id: number | null;
  /** What confirming changed, so a reopen can put it back (ScanConfirmation). */
  confirmation: ColumnType<unknown, string | null | undefined, string | null>;
  /** Set when the bill came by email: who sent it. */
  email_from: ColumnType<string | null, string | null | undefined, string | null>;
}

export type BillEmailStatus = 'waiting' | 'read' | 'failed' | 'duplicate' | 'removed';

/** One file from an email to the shop's bill address. */
export interface BillEmailsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  message_id: string;
  sender: string;
  subject: string | null;
  file_name: string | null;
  media_id: string | null;
  file_hash: string;
  status: ColumnType<BillEmailStatus, BillEmailStatus | undefined, BillEmailStatus>;
  error: string | null;
  scan_id: number | null;
  first_id: number | null;
  received_at: CreatedAt;
  read_at: Date | null;
}

export type ProductRequestStatus = 'pending' | 'approved' | 'rejected';

/** A product someone at the counter wants added; approving it creates the product. */
/** One row per shop day whose closing alert went out. */
export interface DayClosingsTable {
  business_id: Generated<number>;
  day: string;
  announced_at: Generated<Date>;
}

export interface ProductRequestsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  status: ColumnType<ProductRequestStatus, ProductRequestStatus | undefined, ProductRequestStatus>;
  name: string;
  category_id: number | null;
  price: Decimal;
  vat_rate: ColumnType<number, number | undefined, number>;
  vat_exempt: Generated<boolean>;
  barcode: string | null;
  origin_country: string | null;
  photo_media_id: string | null;
  stock: ColumnType<number, number | undefined, number>;
  note: string | null;
  requested_by: number | null;
  requested_at: CreatedAt;
  decided_by: number | null;
  decided_at: Date | null;
  decision_note: string | null;
  product_id: number | null;
}

export interface SupplierProductCodesTable {
  business_id: Generated<number>;
  supplier_id: number;
  code: string;
  product_id: number;
  units_per_pack: ColumnType<number, number | undefined, number>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export const SUPPLIER_PAYMENT_METHODS = ['drawer', 'cash', 'bank'] as const;
/** How a bill was paid: `credit` is a return or credit from the supplier applied to it. */
/** credit: a return or credit applied; offset: set off against what the supplier owes as a customer. */
export type SupplierPaymentMethod = (typeof SUPPLIER_PAYMENT_METHODS)[number] | 'credit' | 'offset';

export interface SupplierPaymentsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  bill_id: number;
  amount: Decimal;
  paid_on: ColumnType<string, string, string>;
  /** drawer: cash out of the shop's till (the cash check expects less); cash: other cash; bank: a transfer. */
  method: SupplierPaymentMethod;
  note: string | null;
  created_by: number | null;
  created_at: CreatedAt;
  voided_at: Date | null;
  voided_by: number | null;
  /** The return or credit applied, for a `credit` payment. */
  credit_id: number | null;
  /** Where the money came from; null only for a credit. */
  place_id: ColumnType<number | null, number | null | undefined, number | null>;
  /** One payment over several bills. */
  group_id: ColumnType<number | null, number | null | undefined, number | null>;
  /** On an offset: the set-off it came from. */
  offset_id: ColumnType<number | null, number | null | undefined, number | null>;
}

export interface PartnerAddressesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  customer_id: number | null;
  supplier_id: number | null;
  label: string;
  address: string;
  city: string | null;
  note: string | null;
  created_at: CreatedAt;
}

export interface PartnerOffsetsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  customer_id: number;
  supplier_id: number;
  amount: Decimal;
  day: ColumnType<string, string, string>;
  note: string | null;
  created_by: number | null;
  created_at: CreatedAt;
}

export interface BonusPayoutsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  customer_id: number;
  year: number;
  bought: Decimal;
  percent: Decimal;
  amount: Decimal;
  day: ColumnType<string, string, string>;
  created_by: number | null;
  created_at: CreatedAt;
}

export interface ReportSubscriptionsTable {
  business_id: Generated<number>;
  user_id: number;
  daily_enabled: Generated<boolean>;
  daily_hour: Generated<number>;
  weekly_enabled: Generated<boolean>;
  /** 1 = Monday … 7 = Sunday. */
  weekly_day: Generated<number>;
  weekly_hour: Generated<number>;
  /** Null means every section. */
  sections: string[] | null;
  email: Generated<boolean>;
  last_daily: ColumnType<string | null, string | null | undefined, string | null>;
  last_weekly: ColumnType<string | null, string | null | undefined, string | null>;
}

export type DocumentKind = 'invoice' | 'credit_note';
export type DocumentPaymentMethod = 'till' | 'account' | 'card';

/** Who a document is from or to, copied when it is issued. */
export interface DocumentParty {
  name: string;
  nui: string | null;
  address: string | null;
  phone: string | null;
}

export interface DocumentNumbersTable {
  business_id: Generated<number>;
  kind: DocumentKind | 'offer' | 'stock_in' | 'stock_out' | 'stock_move' | 'make';
  year: number;
  last_number: number;
}

export interface DocumentsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  kind: DocumentKind;
  number: string;
  issued_at: ColumnType<Date, Date | undefined, never>;
  issued_by: number | null;
  seller: ColumnType<DocumentParty, string, never>;
  customer_id: number | null;
  buyer: ColumnType<DocumentParty | null, string | null, never>;
  /** The invoice a credit note reverses. */
  corrects_id: number | null;
  reason: string | null;
  net_total: Decimal;
  vat_total: Decimal;
  total: Decimal;
  /** The only field that changes after issuing. */
  fiscal_receipt_no: string | null;
  /** Paid at the till, or on the customer's account (their tab), then due by `due_date`. */
  payment_method: ColumnType<DocumentPaymentMethod, DocumentPaymentMethod | undefined, never>;
  due_date: ColumnType<string | null, string | null | undefined, never>;
  /** Of an invoice paid at the till, the part paid by card on the bank's terminal (a split payment); null otherwise. */
  card_amount: ColumnType<string | null, number | null | undefined, never>;
  /** The key the Counter gave the sale at Pay, so a sale sent twice is recorded once. */
  client_key: ColumnType<string | null, string | null | undefined, never>;
  /** "<database>/<document id>" on an invoice TREFIN issued: history only, see migration 047. */
  trefin_ref: ColumnType<string | null, string | null | undefined, never>;
  /** Project tag (projects); null when none. */
  project_id: ColumnType<number | null, number | null | undefined, number | null>;
}

export interface DocumentLinesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  document_id: number;
  sale_id: number;
  return_id: number | null;
  product_name: string;
  /** The product's barcode, else its SKU, when the line was issued. */
  product_code: string | null;
  quantity: number;
  /** VAT-inclusive. */
  unit_price: Decimal;
  vat_rate: number;
  vat_exempt: Generated<boolean>;
  discount_percent: Decimal | null;
  price_before_discount: Decimal | null;
  net_amount: Decimal;
  vat_amount: Decimal;
  total: Decimal;
}

/** One account in the chart (Plani kontabël). */
export interface LedgerAccountsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  number: string;
  name: string;
  class: AccountClass;
  /** TREFIN's "Lloji", e.g. Pasuria Qarkulluese. */
  type_name: string;
  /** TREFIN's "Grupi", e.g. Stoqet. */
  group_name: string;
  cash_flow: ColumnType<CashFlowActivity, CashFlowActivity | undefined, CashFlowActivity>;
  archived_at: Date | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

/** Which account a kind of movement posts to (see DEFAULT_ACCOUNT_LINKS). */
export interface LedgerLinksTable {
  business_id: Generated<number>;
  key: string;
  account_id: number;
}

export type LedgerEntryKind = 'auto' | 'manual' | 'reversal';

export interface LedgerEntriesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  /** A calendar day. */
  entry_date: ColumnType<string, string, string>;
  kind: LedgerEntryKind;
  source_key: string | null;
  description: string;
  warning: string | null;
  fingerprint: string | null;
  reverses_id: number | null;
  reversed_at: Date | null;
  created_by: number | null;
  created_at: CreatedAt;
}

export interface LedgerLinesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  entry_id: number;
  account_id: number;
  debit: Decimal;
  credit: Decimal;
  supplier_id: number | null;
  customer_id: number | null;
  memo: string | null;
}

export interface LedgerQueueTable {
  business_id: Generated<number>;
  source_table: string;
  row_id: number;
  queued_at: CreatedAt;
}

/** A VAT month someone has filed, asked a refund for, or typed the credit carried in for. */
export interface VatMonthsTable {
  business_id: Generated<number>;
  /** Its first day. */
  month: ColumnType<string, string, string>;
  filed_at: Date | null;
  filed_by: number | null;
  /** The return as filed (see VatService). */
  figures: unknown;
  /** Box 70. */
  refund: ColumnType<string, number | string | undefined, number | string>;
  /** Box 68 typed by hand. */
  carried_in: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  updated_by: number | null;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export type MoneyPlaceKind = 'till' | 'safe' | 'bank';

/** A place money is kept: the shop's till, a carwash's till, a safe, a bank account. */
export interface MoneyPlacesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  kind: MoneyPlaceKind;
  name: string | null;
  carwash_id: number | null;
  bank_name: string | null;
  iban: string | null;
  account_id: number | null;
  is_default: Generated<boolean>;
  opening_balance: ColumnType<string, number | string | undefined, number | string>;
  opening_day: ColumnType<string | null, string | null | undefined, string | null>;
  statement_layout: ColumnType<unknown | null, string | null | undefined, string | null>;
  archived_at: Date | null;
  created_by: number | null;
  created_at: CreatedAt;
}

export type CounterEventKind = 'line_removed' | 'basket_cancelled' | 'drawer_opened' | 'print_failed' | 'reprinted' | 'x_report' | 'z_report' | 'rabat_allowed' | 'person_switched' | 'pay_later_allowed';

/** Something that happened at the counter other than a sale, by person (the counter report). */
export interface CounterEventsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  kind: CounterEventKind;
  user_id: number | null;
  product_id: number | null;
  quantity: number | null;
  amount: Decimal | null;
  reason: string | null;
  document_id: number | null;
  created_at: CreatedAt;
}

/** Money taken from one place to another; one side empty when the owner put it in or took it out. */
export interface MoneyMovesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  day: ColumnType<string, string, string>;
  amount: Decimal;
  from_place_id: number | null;
  to_place_id: number | null;
  note: string | null;
  created_by: number | null;
  created_at: CreatedAt;
  voided_at: Date | null;
  voided_by: number | null;
}

export interface PaymentGroupsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  supplier_id: number | null;
  place_id: number;
  paid_on: ColumnType<string, string, string>;
  amount: Decimal;
  note: string | null;
  created_by: number | null;
  created_at: CreatedAt;
}

export interface TabAllocationsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  payment_id: number;
  /** Null: the tab's charges that are on no invoice. */
  document_id: number | null;
  amount: Decimal;
}

export type BankRuleAction = 'expense' | 'transfer' | 'owner';

export interface BankRulesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  place_id: number | null;
  contains: string;
  direction: 'in' | 'out';
  action: BankRuleAction;
  category: string | null;
  supplier_id: number | null;
  other_place_id: number | null;
  created_by: number | null;
  created_at: CreatedAt;
}

export interface BankStatementsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  place_id: number;
  file_name: string;
  format: 'csv' | 'xlsx' | 'pdf';
  first_day: ColumnType<string | null, string | null | undefined, string | null>;
  last_day: ColumnType<string | null, string | null | undefined, string | null>;
  opening_balance: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  closing_balance: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  lines_read: number;
  lines_skipped: number;
  uploaded_by: number | null;
  uploaded_at: CreatedAt;
}

export type BankLineStatus = 'open' | 'done' | 'skipped';
export type BankLineDoneKind = 'payment' | 'payment_group' | 'tab_payment' | 'move' | 'expense' | 'payroll';

export interface BankLinesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  statement_id: number;
  place_id: number;
  day: ColumnType<string, string, string>;
  text: string;
  amount: Decimal;
  balance: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  fingerprint: string;
  position: number;
  status: ColumnType<BankLineStatus, BankLineStatus | undefined, BankLineStatus>;
  done_kind: BankLineDoneKind | null;
  done_ref: number | null;
  made_record: Generated<boolean>;
  rule_id: number | null;
  done_by: number | null;
  done_at: Date | null;
}

/** Questions the accountant leaves on a document, answered there by the people who run the shop. */
export interface DocumentThreadsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  subject: string;
  status: ColumnType<'open' | 'answered', 'open' | 'answered' | undefined, 'open' | 'answered'>;
  opened_by: number | null;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface DocumentNotesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  thread_id: number;
  author_id: number | null;
  body: string;
  created_at: CreatedAt;
}

export type PortalOrderStatus = 'sent' | 'seen' | 'changed' | 'accepted' | 'declined' | 'cancelled';

/** Someone at a business customer who may sign in to the portal. Never a dashboard user. */
export interface PortalUsersTable {
  business_id: Generated<number>;
  id: Generated<number>;
  customer_id: number;
  name: string;
  email: string | null;
  phone: string | null;
  language: Generated<'sq' | 'en'>;
  created_by: number | null;
  created_at: CreatedAt;
  last_seen_at: Date | null;
  removed_at: Date | null;
}

export interface PortalLinksTable {
  business_id: Generated<number>;
  id: Generated<number>;
  portal_user_id: number;
  purpose: 'invite' | 'sign_in';
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: CreatedAt;
}

export interface PortalSessionsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  portal_user_id: number;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: CreatedAt;
  last_used_at: Generated<Date>;
}

export interface PortalOrdersTable {
  business_id: Generated<number>;
  id: Generated<number>;
  customer_id: number;
  portal_user_id: number | null;
  note: string | null;
  status: Generated<PortalOrderStatus>;
  net: ColumnType<string, number, number>;
  vat: ColumnType<string, number, number>;
  total: ColumnType<string, number, number>;
  seen_at: Date | null;
  seen_by: number | null;
  decided_at: Date | null;
  decided_by: number | null;
  decline_reason: string | null;
  offer_id: number | null;
  change_reason: string | null;
  changed_at: Date | null;
  changed_by: number | null;
  change_seen_at: Date | null;
  change_agreed_at: Date | null;
  /** The order as the customer last agreed it: { net, vat, total, lines }. */
  previous: ColumnType<unknown, string | null, string | null>;
  created_at: CreatedAt;
}

export interface PortalOrderLinesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  order_id: number;
  product_id: number;
  product_name: string;
  unit: string;
  quantity: number;
  unit_price: ColumnType<string, number, number>;
  vat_rate: ColumnType<string, number, number>;
  total: ColumnType<string, number, number>;
  in_stock: boolean;
}

export interface ProjectsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  name: string;
  note: string | null;
  closed_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_by: number | null;
  created_at: CreatedAt;
}

/** One part of a made product's recipe: how many go into one. */
export interface RecipePartsTable {
  business_id: Generated<number>;
  product_id: number;
  part_id: number;
  quantity: number;
  position: ColumnType<number, number | undefined, number>;
}

export interface MakesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  number: string;
  product_id: number;
  quantity: number;
  unit_cost: ColumnType<string, number, number>;
  cost_before: ColumnType<string | null, number | null, number | null>;
  /** Read through to_char, so kept as text. */
  day: string;
  location_id: number | null;
  expires_on: ColumnType<string | null, string | null, string | null>;
  note: string | null;
  created_by: number | null;
  created_at: CreatedAt;
  voided_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  voided_by: ColumnType<number | null, number | null | undefined, number | null>;
}

export interface MakeLinesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  make_id: number;
  product_id: number;
  quantity: number;
  unit_cost: ColumnType<string, number, number>;
}

export type SerialStatus = 'in_stock' | 'sold';

export interface SerialsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  product_id: number;
  serial: string;
  status: ColumnType<SerialStatus, SerialStatus | undefined, SerialStatus>;
  bill_id: ColumnType<number | null, number | null | undefined, number | null>;
  stock_document_id: ColumnType<number | null, number | null | undefined, number | null>;
  order_id: ColumnType<number | null, number | null | undefined, number | null>;
  came_on: ColumnType<string | null, string | null | undefined, string | null>;
  sale_id: ColumnType<number | null, number | null | undefined, number | null>;
  document_id: ColumnType<number | null, number | null | undefined, number | null>;
  customer_id: ColumnType<number | null, number | null | undefined, number | null>;
  sold_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  warranty_ends: ColumnType<string | null, string | null | undefined, string | null>;
  returned_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_by: number | null;
  created_at: CreatedAt;
}

/** The 4VD developer opening a business he isn't a member of: one row per sign-in session, shown to that business. */
export interface SupportVisitsTable {
  id: Generated<number>;
  business_id: Generated<number>;
  developer_id: number;
  developer_name: string;
  session_id: string;
  started_at: Generated<Date>;
  last_seen_at: Generated<Date>;
  reason: string | null;
}

/** A change the 4VD developer made during a support visit. before/after are kept for a later undo. */
export interface SupportActionsTable {
  id: Generated<number>;
  business_id: Generated<number>;
  visit_id: number;
  at: Generated<Date>;
  method: string;
  path: string;
  entity: string | null;
  entity_id: string | null;
  status: number | null;
  before: unknown | null;
  after: unknown | null;
}

export interface Database {
  support_visits: SupportVisitsTable;
  support_actions: SupportActionsTable;
  portal_users: PortalUsersTable;
  portal_links: PortalLinksTable;
  portal_sessions: PortalSessionsTable;
  portal_orders: PortalOrdersTable;
  portal_order_lines: PortalOrderLinesTable;
  users: UsersTable;
  refresh_tokens: RefreshTokensTable;
  pin_attempts: PinAttemptsTable;
  offline_shortfalls: OfflineShortfallsTable;
  rabat_approvals: RabatApprovalsTable;
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
  tenants: TenantsTable;
  memberships: MembershipsTable;
  media: MediaTable;
  attachments: AttachmentsTable;
  invites: InvitesTable;
  account_tokens: AccountTokensTable;
  user_identities: UserIdentitiesTable;
  passkeys: PasskeysTable;
  email_outbox: EmailOutboxTable;
  returns: ReturnsTable;
  write_offs: WriteOffsTable;
  stock_counts: StockCountsTable;
  stock_count_lines: StockCountLinesTable;
  carwashes: CarwashesTable;
  carwash_days: CarwashDaysTable;
  cash_counts: CashCountsTable;
  cash_openings: CashOpeningsTable;
  assistant_chats: AssistantChatsTable;
  assistant_messages: AssistantMessagesTable;
  bill_repeats: BillRepeatsTable;
  bill_lines: BillLinesTable;
  no_expense_days: NoExpenseDaysTable;
  customers: CustomersTable;
  tab_entries: TabEntriesTable;
  offers: OffersTable;
  offer_lines: OfferLinesTable;
  customer_deliveries: CustomerDeliveriesTable;
  partner_addresses: PartnerAddressesTable;
  partner_offsets: PartnerOffsetsTable;
  bonus_payouts: BonusPayoutsTable;
  suppliers: SuppliersTable;
  purchase_orders: PurchaseOrdersTable;
  purchase_order_lines: PurchaseOrderLinesTable;
  expiry_dates: ExpiryDatesTable;
  sales_ledger: SalesLedgerView;
  people: PeopleView;
  document_numbers: DocumentNumbersTable;
  documents: DocumentsTable;
  document_lines: DocumentLinesTable;
  supplier_bills: SupplierBillsTable;
  supplier_payments: SupplierPaymentsTable;
  bill_scans: BillScansTable;
  bill_emails: BillEmailsTable;
  product_requests: ProductRequestsTable;
  day_closings: DayClosingsTable;
  supplier_product_codes: SupplierProductCodesTable;
  report_subscriptions: ReportSubscriptionsTable;
  product_duplicate_flags: ProductDuplicateFlagsTable;
  product_barcodes: ProductBarcodesTable;
  stock_documents: StockDocumentsTable;
  stock_locations: StockLocationsTable;
  location_stock: LocationStockTable;
  stock_moves: StockMovesTable;
  stock_move_lines: StockMoveLinesTable;
  stock_document_lines: StockDocumentLinesTable;
  projects: ProjectsTable;
  recipe_parts: RecipePartsTable;
  makes: MakesTable;
  make_lines: MakeLinesTable;
  serials: SerialsTable;
  fixed_assets: FixedAssetsTable;
  depreciation_months: DepreciationMonthsTable;
  depreciation_lines: DepreciationLinesTable;
  ledger_accounts: LedgerAccountsTable;
  ledger_links: LedgerLinksTable;
  ledger_entries: LedgerEntriesTable;
  ledger_lines: LedgerLinesTable;
  ledger_queue: LedgerQueueTable;
  vat_months: VatMonthsTable;
  document_threads: DocumentThreadsTable;
  document_notes: DocumentNotesTable;
  money_places: MoneyPlacesTable;
  counter_events: CounterEventsTable;
  money_moves: MoneyMovesTable;
  payment_groups: PaymentGroupsTable;
  tab_allocations: TabAllocationsTable;
  bank_rules: BankRulesTable;
  bank_statements: BankStatementsTable;
  bank_lines: BankLinesTable;
  opening_lines: OpeningLinesTable;
  trefin_months: TrefinMonthsTable;
  book_years: BookYearsTable;
  tax_instalments: TaxInstalmentsTable;
  tax_declarations: TaxDeclarationsTable;
  employees: EmployeesTable;
  payroll_months: PayrollMonthsTable;
  payroll_lines: PayrollLinesTable;
  payroll_payments: PayrollPaymentsTable;
  payroll_payment_lines: PayrollPaymentLinesTable;
  leave_entries: LeaveEntriesTable;
  trefin_deleted_receipts: TrefinDeletedReceiptsTable;
  trefin_stock_documents: TrefinStockDocumentsTable;
  trefin_stock_lines: TrefinStockLinesTable;
  trefin_money_lines: TrefinMoneyLinesTable;
  trefin_journal_entries: TrefinJournalEntriesTable;
  trefin_journal_lines: TrefinJournalLinesTable;
  trefin_offers: TrefinOffersTable;
  trefin_offer_lines: TrefinOfferLinesTable;
  trefin_activity: TrefinActivityTable;
}

export type OpeningLineKind = 'place' | 'stock' | 'supplier' | 'customer' | 'account';
export type OpeningSource = 'trefin' | 'counted' | 'statement' | 'stock' | 'typed';

/** One line of what the shop has and owes when the books start (see migration 044). */
export interface OpeningLinesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  kind: OpeningLineKind;
  account_id: number | null;
  place_id: number | null;
  supplier_id: number | null;
  customer_id: number | null;
  /** Debits minus credits, for typed lines; null for worked-out ones. */
  amount: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  trefin_amount: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  source: Generated<OpeningSource>;
  note: string | null;
  confirmed_amount: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  confirmed_by: number | null;
  confirmed_at: Date | null;
  updated_by: number | null;
  updated_at: Generated<Date>;
}

export type UserRow = Selectable<UsersTable>;
export type PasskeyRow = Selectable<PasskeysTable>;
export type NewUserRow = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type CategoryRow = Selectable<CategoriesTable>;
export type NotificationRow = Selectable<NotificationsTable>;

/** A receipt someone deleted in TREFIN, kept to look at (see migration 047). */
export interface TrefinDeletedReceiptsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  trefin_ref: string;
  number: string | null;
  kind: 'receipt' | 'invoice';
  sold_on: ColumnType<string, string, string>;
  deleted_at: Date;
  deleted_by: string | null;
  customer: string | null;
  total: ColumnType<string, number | string, number | string>;
  lines: ColumnType<TrefinReceiptLine[], string, string>;
}

/** TREFIN's starting stock, a correction or a count, kept to look at (see migration 048). */
export interface TrefinStockDocumentsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  trefin_ref: string;
  kind: 'opening' | 'correction' | 'count';
  number: string | null;
  dated: ColumnType<string, string, string>;
  source: string;
}

export interface TrefinStockLinesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  document_id: number;
  product_id: number | null;
  product_name: string;
  quantity: ColumnType<string, number, number>;
  counted: ColumnType<string | null, number | null, number | null>;
  unit_cost: ColumnType<string | null, number | null, number | null>;
}

/** A payment from TREFIN's cash desk or bank, kept to look at (see migration 049). */
export interface TrefinMoneyLinesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  trefin_ref: string;
  place: 'till' | 'bank';
  bank_name: string | null;
  moved_on: ColumnType<string, string, string>;
  kind: 'supplier_payment' | 'customer_payment' | 'bank_payment';
  number: string | null;
  amount: ColumnType<string, number, number>;
  supplier_id: number | null;
  customer_id: number | null;
  party_name: string | null;
  document: string | null;
  account: string | null;
  description: string | null;
}

/** An entry of TREFIN's journal, kept to look at in Books (see migration 050). */
export interface TrefinJournalEntriesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  trefin_ref: string;
  dated: ColumnType<string, string, string>;
  kind: string;
  reference: string | null;
  source: string;
}

/** One of TREFIN's offers (price quotes), on the Offers page (see migration 051). */
export interface TrefinOffersTable {
  business_id: Generated<number>;
  id: Generated<number>;
  trefin_ref: string;
  number: string | null;
  offered_on: ColumnType<string, string, string>;
  customer_id: number | null;
  party_name: string | null;
  total: ColumnType<string, number, number>;
  source: string;
}

export interface TrefinOfferLinesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  offer_id: number;
  product_id: number | null;
  product_name: string;
  quantity: ColumnType<string, number, number>;
  unit_price: ColumnType<string, number, number>;
  total: ColumnType<string, number, number>;
}

/** A line of TREFIN's activity log, in Activity. */
export interface TrefinActivityTable {
  business_id: Generated<number>;
  id: Generated<number>;
  done_at: Date;
  person: string | null;
  action: string;
  what: string;
  subject: string | null;
}

export interface TrefinJournalLinesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  entry_id: number;
  dated: ColumnType<string, string, string>;
  account: string;
  party: string | null;
  debit: ColumnType<string, number, number>;
  credit: ColumnType<string, number, number>;
}

export interface TrefinReceiptLine {
  name: string;
  quantity: number;
  total: number;
}

/** A VAT month's documents as TREFIN had them, to run 4VD next to TREFIN (see TrefinCompareService). */
export interface TrefinMonthsTable {
  business_id: Generated<number>;
  /** Its first day. */
  month: ColumnType<string, string, string>;
  items: unknown;
  source: string | null;
  loaded_by: number | null;
  loaded_at: ColumnType<Date, Date | undefined, Date>;
  /** Difference key → { note, by, at }. */
  explained: ColumnType<unknown, unknown | undefined, unknown>;
}

/** A closed year (see migration 052). */
export interface BookYearsTable {
  business_id: Generated<number>;
  year: number;
  profit: ColumnType<string, number, number>;
  tax: ColumnType<string, number, number>;
  tax_entry_id: number | null;
  close_entry_id: number | null;
  closed_by: number | null;
  closed_at: ColumnType<Date, Date | undefined, Date>;
}

/** A year's income declaration (CD or PD): typed inputs and, once filed, the figures as filed (migration 076). */
export interface TaxDeclarationsTable {
  business_id: Generated<number>;
  year: number;
  inputs: ColumnType<unknown, string | undefined, string>;
  filed_on: ColumnType<string | null, string | null | undefined, string | null>;
  filed_by: number | null;
  filed_at: Date | null;
  filed: ColumnType<unknown, string | null | undefined, string | null>;
  updated_by: number | null;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

/** A quarterly profit tax instalment (TM) paid (see migration 052); quarter 0 is the rest, paid with the declaration. */
export interface TaxInstalmentsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  year: number;
  quarter: number;
  amount: ColumnType<string, number, number>;
  paid_on: ColumnType<string, string, string>;
  place_id: number;
  entry_id: number | null;
  note: string | null;
  created_by: number | null;
  created_at: ColumnType<Date, Date | undefined, Date>;
  undone_at: Date | null;
  undone_by: number | null;
}

type Day = ColumnType<string, string, string>;
type NullableDay = ColumnType<string | null, string | null | undefined, string | null>;

/** A person on the payroll (see migration 068). */
export interface EmployeesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  user_id: number | null;
  name: string;
  personal_number: string | null;
  job_title: string | null;
  contract: Generated<'open' | 'fixed' | 'part_time'>;
  started_on: Day;
  contract_ends_on: NullableDay;
  left_on: NullableDay;
  pay_basis: Generated<'gross' | 'net'>;
  pay_amount: Decimal;
  secondary: Generated<boolean>;
  non_resident: Generated<boolean>;
  extra_pension_employee: ColumnType<string, number | string | undefined, number | string>;
  extra_pension_employer: ColumnType<string, number | string | undefined, number | string>;
  bank_account: string | null;
  bank_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  birth_date: NullableDay;
  place: Generated<'shop' | 'carwash'>;
  leave_days: ColumnType<string, number | string | undefined, number | string>;
  note: string | null;
  created_by: number | null;
  created_at: CreatedAt;
}

export interface PayrollMonthsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  month: Day;
  confirmed_by: number | null;
  confirmed_at: CreatedAt;
  voided_at: Date | null;
  voided_by: number | null;
}

export interface PayrollLinesTable {
  business_id: Generated<number>;
  month_id: number;
  employee_id: number;
  place: 'shop' | 'carwash';
  secondary: boolean;
  non_resident: boolean;
  gross: Decimal;
  employee_rate: Decimal;
  employer_rate: Decimal;
  employee_pension: Decimal;
  employer_pension: Decimal;
  taxable: Decimal;
  tax: Decimal;
  net: Decimal;
  changed_reason: string | null;
}

export type PayrollPaymentKind = 'wages' | 'tax' | 'pension';

export interface PayrollPaymentsTable {
  business_id: Generated<number>;
  id: Generated<number>;
  month_id: number;
  kind: PayrollPaymentKind;
  place_id: number;
  paid_on: Day;
  amount: Decimal;
  carwash_amount: ColumnType<string, number | string | undefined, number | string>;
  note: string | null;
  created_by: number | null;
  created_at: CreatedAt;
  voided_at: Date | null;
  voided_by: number | null;
}

export interface PayrollPaymentLinesTable {
  business_id: Generated<number>;
  payment_id: number;
  employee_id: number;
  amount: Decimal;
}

export interface LeaveEntriesTable {
  business_id: Generated<number>;
  id: Generated<number>;
  employee_id: number;
  kind: 'taken' | 'adjust';
  from_day: Day;
  to_day: Day;
  days: Decimal;
  note: string | null;
  created_by: number | null;
  created_at: CreatedAt;
}
