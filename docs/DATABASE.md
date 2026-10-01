# Database Schema

## Overview
PostgreSQL database for managing products, inventory, pricing, and sales tracking.

The source of truth is the migration code in `backend/src/database/migrations/`; the SQL below is the original plan.
The real schema differs in these ways:

- **Timestamps are `TIMESTAMPTZ`** (always stored as UTC) instead of `TIMESTAMP`
- **`users.password` is called `password_hash`**, and `role` has a CHECK for `admin`, `employee`, `family`
- **Soft delete:** `users`, `categories` and `products` have `deleted_at`. `categories` also has `updated_at`
- **Uniqueness ignores deleted rows:** category names (case-insensitive) and SKUs only need to be unique among rows that aren't deleted (partial unique indexes)
- **CHECK constraints** stop negative stock, negative prices, zero-quantity sales and adjustments, and tiers below 2 units
- **`stock_adjustments.reason` is required**
- **Child rows cascade:** `inventory`, `bulk_pricing_tiers` and `product_images` are removed with their product
- **New `refresh_tokens` table** (`user_id`, `token_hash` (SHA-256), `expires_at`, `revoked_at`), which makes logout and single-use refresh tokens possible
- **New `favorites` table** (`user_id`, `product_id`, `created_at`, composite primary key) for the wishlist
- **`idx_inventory_product` and `idx_users_email` were dropped:** those columns are `UNIQUE`, so PostgreSQL already indexes them
- **`sales.total_amount` is `DECIMAL(12, 2)`** so large orders can't overflow
- **`sales.unit_cost`** (migration 002): the product's cost when it was sold, so profit doesn't change when a cost price is edited. Sales from before this migration were filled in from the cost price at the time of the migration
- **New `activity_log` table** (migration 002): `user_id`, `action`, `entity_type`, `entity_id`, `summary`, `details` (JSONB), `created_at`, indexed by time, user and entity

## Tables

### users
User accounts with roles and access control
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL, -- hashed
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL, -- 'admin', 'employee', 'family'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT true
);
```

### categories
Product categories
```sql
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### products
Product catalog with base information
```sql
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category_id INT NOT NULL REFERENCES categories(id),
  base_price DECIMAL(10, 2) NOT NULL,
  cost_price DECIMAL(10, 2), -- for profit tracking
  image_url VARCHAR(500),
  sku VARCHAR(100) UNIQUE, -- Stock Keeping Unit
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### inventory
Real-time stock levels
```sql
CREATE TABLE inventory (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL UNIQUE REFERENCES products(id),
  quantity_on_hand INT NOT NULL DEFAULT 0,
  reorder_level INT DEFAULT 10, -- Alert when below this
  last_restocked_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### bulk_pricing_tiers
Bulk pricing for products
```sql
CREATE TABLE bulk_pricing_tiers (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  quantity_min INT NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, quantity_min)
);
```

### sales
Sales transactions and history
```sql
CREATE TABLE sales (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  quantity_sold INT NOT NULL,
  price_per_unit DECIMAL(10, 2) NOT NULL,
  total_amount DECIMAL(10, 2) GENERATED ALWAYS AS (quantity_sold * price_per_unit) STORED,
  sold_by INT REFERENCES users(id), -- User who made the sale
  sale_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### stock_adjustments
Manual inventory adjustments and audit trail
```sql
CREATE TABLE stock_adjustments (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  adjustment_quantity INT NOT NULL, -- Positive or negative
  reason VARCHAR(255), -- 'Damage', 'Recount', 'Return', etc.
  adjusted_by INT REFERENCES users(id),
  adjustment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### product_images
Multiple images per product (optional, if you want to store multiple)
```sql
CREATE TABLE product_images (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  image_url VARCHAR(500) NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### notifications
Push notification logs
```sql
CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50), -- 'low_stock', 'new_product', etc.
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

### settings
Owner-editable limits, one row per key: `key` (primary key), `value` (JSONB), `updated_by`, `updated_at`. Seeded with `refund_approval_limit = 50` and `return_window_days = 14`.

### returns
A refund for part or all of a sale. `sale_id`, `quantity`, `refund_amount`, `condition` (`resellable` or `damaged`), `notes`, `approval_reasons` (TEXT[], why it waited, worked out with the limits in force when it was asked), and the approval columns: `status` (`pending`, `approved` or `rejected`), `requested_by`, `requested_at`, `decided_by`, `decided_at`, `decision_note`.

### write_offs
Stock that left as a loss. `product_id`, `quantity`, `reason` (`damaged`, `lost`, `expired` or `other`), `unit_cost` (cost price when reported), `return_id` (set when it came from a damaged return), `notes`, and the same approval columns.

### stock_counts
A count session. `category_id` (null = whole shop), `status` (`open`, `submitted`, `closed` or `cancelled`), `started_by`, `started_at`, `submitted_by`, `submitted_at`, `closed_at`.

### stock_count_lines
One counted product: `count_id`, `product_id` (unique together), `counted_quantity`, `expected_quantity` and `unit_cost` (both captured when counted), `counted_by`, `counted_at`, `status` (null until submitted, then `match`, `pending`, `approved` or `rejected`), `decided_by`, `decided_at`, `decision_note`.

### sales_ledger (view)
Sales, plus approved returns as negative rows dated when approved: `sale_id`, `return_id` (null for a sale), `product_id`, `sold_by`, `occurred_at`, `units`, `revenue`, `unit_cost`, `cost`. Every money report reads this, so refunds count the same way everywhere.

## Indexes (for performance)
```sql
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_inventory_product ON inventory(product_id);
CREATE INDEX idx_sales_product ON sales(product_id);
CREATE INDEX idx_sales_date ON sales(sale_date);
CREATE INDEX idx_stock_adjustments_product ON stock_adjustments(product_id);
CREATE INDEX idx_bulk_pricing_product ON bulk_pricing_tiers(product_id);
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_users_email ON users(email);
```

---

## Relationships
- `products` → `categories` (one-to-many)
- `products` → `inventory` (one-to-one)
- `products` → `bulk_pricing_tiers` (one-to-many)
- `products` → `sales` (one-to-many)
- `products` → `product_images` (one-to-many)
- `products` → `stock_adjustments` (one-to-many)
- `users` → `sales` (one-to-many)
- `users` → `stock_adjustments` (one-to-many)
- `users` → `notifications` (one-to-many)

---

## Migration Plan

Migrations are written with Kysely and live in `backend/src/database/migrations/`, numbered in run order and registered in `migrations/index.ts`.

**Commands** (run from `backend/`):
```bash
docker compose up -d       # from the repo root: local PostgreSQL + a separate test database
npm run db:setup           # migrate + seed (categories and the admin from SEED_ADMIN_* in .env)
npm run migrate            # apply pending migrations
npm run migrate:down       # undo the most recent migration
npm run seed -- --demo     # also add demo products and a month of demo sales (local only)
npm run migrate:prod       # in production, after `npm run build`
```

**Adding a migration:** create `00N_short_name.ts` with `up` and `down`, add it to `migrations/index.ts`, and update `src/database/types.ts` to match.

**Schema versions:**
- 001_initial_schema: every table above, including notifications, stock adjustments, product images, refresh tokens and favorites
- 002_reports_and_activity: `sales.unit_cost` and the `activity_log` table

---

## Notes
- All timestamps use UTC
- Prices stored as DECIMAL for accuracy (not float)
- `stock_adjustments` table maintains audit trail for compliance
- Foreign keys prevent orphaned data
- Indexes optimize common queries (by product, by date, by user)
- Consider archiving old sales data yearly for performance

---

## Backup Strategy
**Method:** Managed backups via hosting provider (Render/Railway/AWS)

- Daily automated backups
- 7-day retention
- Point-in-time recovery available
- Tested monthly