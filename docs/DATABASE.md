# Database Schema

## Overview
PostgreSQL database for managing products, inventory, pricing, and sales tracking.

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

**Initial Setup:** When you start the project

**Steps:**
1. Create all tables in order (respecting foreign keys)
2. Add indexes for performance
3. Insert initial categories
4. Create initial admin user

**Commands:**
```bash
npm run migrate
# or
npm run db:setup
```

**Schema versioning:**
- V1: Initial tables (products, inventory, users, sales)
- V2: Add notifications and audit trail (stock_adjustments)
- V3: Multi-image support (product_images)

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