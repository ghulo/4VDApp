import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

/**
 * TypeScript view of the tables created by the migrations in ./migrations.
 * Keep this file in sync whenever a migration changes a table.
 */

// pg returns NUMERIC/DECIMAL as strings to avoid losing precision. We accept
// numbers on insert/update and convert to numbers when mapping to API objects.
type Decimal = ColumnType<string, number | string, number | string>;
type CreatedAt = ColumnType<Date, Date | undefined, never>;
type UpdatedAt = ColumnType<Date, Date | undefined, Date>;

export const USER_ROLES = ['admin', 'employee', 'family'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface UsersTable {
  id: Generated<number>;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  is_active: Generated<boolean>;
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
  sale_date: ColumnType<Date, Date | undefined, Date>;
  notes: string | null;
  created_at: CreatedAt;
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
  created_at: CreatedAt;
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
