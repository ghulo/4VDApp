import { type Kysely, sql } from 'kysely';

/**
 * V1 schema from docs/DATABASE.md, with these deliberate changes:
 * - TIMESTAMPTZ instead of TIMESTAMP so every time is stored as UTC
 * - deleted_at on users, categories and products (soft delete, see
 *   docs/ENGINEERING_RULES.md)
 * - CHECK constraints so the database itself rejects negative stock/prices
 * - refresh_tokens (needed for logout and token rotation)
 * - favorites (the wishlist feature in the README)
 * - Dropped idx_inventory_product and idx_users_email: UNIQUE columns already
 *   get an index, so those would be duplicates
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const statements = [
    sql`CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'employee', 'family')),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )`,
    sql`CREATE TABLE refresh_tokens (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    sql`CREATE TABLE categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )`,
    // Names only need to be unique among categories that still exist, so a
    // deleted "Chairs" category does not block creating a new one.
    sql`CREATE UNIQUE INDEX idx_categories_name_active ON categories (lower(name)) WHERE deleted_at IS NULL`,
    sql`CREATE TABLE products (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      category_id INT NOT NULL REFERENCES categories(id),
      base_price DECIMAL(10, 2) NOT NULL CHECK (base_price >= 0),
      cost_price DECIMAL(10, 2) CHECK (cost_price >= 0),
      image_url VARCHAR(500),
      sku VARCHAR(100),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )`,
    sql`CREATE UNIQUE INDEX idx_products_sku_active ON products (sku) WHERE deleted_at IS NULL AND sku IS NOT NULL`,
    sql`CREATE TABLE inventory (
      id SERIAL PRIMARY KEY,
      product_id INT NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
      quantity_on_hand INT NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
      reorder_level INT NOT NULL DEFAULT 10 CHECK (reorder_level >= 0),
      last_restocked_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    sql`CREATE TABLE bulk_pricing_tiers (
      id SERIAL PRIMARY KEY,
      product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity_min INT NOT NULL CHECK (quantity_min > 1),
      price DECIMAL(10, 2) NOT NULL CHECK (price >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (product_id, quantity_min)
    )`,
    sql`CREATE TABLE sales (
      id SERIAL PRIMARY KEY,
      product_id INT NOT NULL REFERENCES products(id),
      quantity_sold INT NOT NULL CHECK (quantity_sold > 0),
      price_per_unit DECIMAL(10, 2) NOT NULL CHECK (price_per_unit >= 0),
      total_amount DECIMAL(12, 2) GENERATED ALWAYS AS (quantity_sold * price_per_unit) STORED,
      sold_by INT REFERENCES users(id),
      sale_date TIMESTAMPTZ NOT NULL DEFAULT now(),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    sql`CREATE TABLE stock_adjustments (
      id SERIAL PRIMARY KEY,
      product_id INT NOT NULL REFERENCES products(id),
      adjustment_quantity INT NOT NULL CHECK (adjustment_quantity <> 0),
      reason VARCHAR(255) NOT NULL,
      adjusted_by INT REFERENCES users(id),
      adjustment_date TIMESTAMPTZ NOT NULL DEFAULT now(),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    sql`CREATE TABLE product_images (
      id SERIAL PRIMARY KEY,
      product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      image_url VARCHAR(500) NOT NULL,
      is_primary BOOLEAN NOT NULL DEFAULT false,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    sql`CREATE TABLE notifications (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      type VARCHAR(50),
      is_read BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    sql`CREATE TABLE favorites (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, product_id)
    )`,
    sql`CREATE INDEX idx_products_category ON products(category_id)`,
    sql`CREATE INDEX idx_sales_product ON sales(product_id)`,
    sql`CREATE INDEX idx_sales_date ON sales(sale_date)`,
    sql`CREATE INDEX idx_stock_adjustments_product ON stock_adjustments(product_id)`,
    sql`CREATE INDEX idx_bulk_pricing_product ON bulk_pricing_tiers(product_id)`,
    sql`CREATE INDEX idx_notifications_user ON notifications(user_id)`,
    sql`CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id)`,
    sql`CREATE INDEX idx_favorites_product ON favorites(product_id)`,
  ];

  for (const statement of statements) {
    await statement.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const tablesInDropOrder = [
    'favorites',
    'notifications',
    'product_images',
    'stock_adjustments',
    'sales',
    'bulk_pricing_tiers',
    'inventory',
    'products',
    'categories',
    'refresh_tokens',
    'users',
  ];
  for (const table of tablesInDropOrder) {
    await sql`DROP TABLE IF EXISTS ${sql.table(table)}`.execute(db);
  }
}
