# API Documentation

## Base URL
```
Development: http://localhost:3000/api
Production: [Your production domain]/api
```

The health check lives outside `/api`: `GET /health`.

## Authentication
**Method:** JWT access token + single-use refresh token

**Flow:**
1. `POST /auth/login` with email and password
2. The server returns an access token (valid 7 days, `JWT_EXPIRES_IN`) and a refresh token (valid 30 days, `REFRESH_TOKEN_TTL_DAYS`)
3. Send the access token on every request: `Authorization: Bearer <token>`
4. When a request returns 401, call `POST /auth/refresh` with the refresh token to get a **new pair**. The old refresh token stops working, so store the new one
5. `POST /auth/logout` revokes the refresh token

The server checks the account on every authenticated request, so deactivating someone or changing their role takes effect immediately.

**JWT payload:**
```json
{ "userId": 1, "email": "user@example.com", "role": "admin", "iat": 1234567890, "exp": 1234654290 }
```

## Roles
| Role | Can do |
|------|--------|
| `admin` | Everything |
| `employee` | Browse products, record sales, favorites |
| `family` | Browse products, favorites |

Every endpoint except login and token refresh needs a token. Endpoints marked "any role" work for admin, employee and family; with an admin token they also return admin-only fields (cost prices, hidden products).

## Rate Limiting
Per 15 minutes:
- Visitors (no token): 100 requests per IP
- Logged-in users: 500 requests per account
- Admins: 1000 requests per account
- Failed logins: 10 per IP (successful logins don't count)

Responses carry the standard `RateLimit` and `RateLimit-Policy` headers (IETF draft 8). Going over returns `429`.

## Response Format
Every response has the same shape:
```json
{
  "success": true,
  "data": {},
  "message": "OK",
  "error": null,
  "meta": { "page": 1, "limit": 20, "total": 100 }
}
```
- `meta` is only present on paginated lists
- On failure, `success` is `false`, `data` is `null`, `error` is a machine-readable code and `message` is a sentence you can show to a person

**Error codes:** `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500).

Validation errors list every problem at once, e.g. `"email: Invalid email address; password: Too small"`.

## Pagination
Lists accept `page` (default 1) and `limit` (default 20, max 100).

---

## Auth

| Method & path | Auth | Body | Returns |
|---|---|---|---|
| `POST /auth/login` | – | `{ email, password }` | `{ token, refreshToken, user }` |
| `POST /auth/refresh` | – | `{ refreshToken }` | `{ token, refreshToken }` |
| `POST /auth/logout` | any user | `{ refreshToken? }` (omit to log out on every device) | `null` |
| `GET /auth/me` | any user | – | the user |

A user looks like `{ id, email, name, role, isActive, createdAt }`.

---

## Categories

| Method & path | Auth | Notes |
|---|---|---|
| `GET /categories` | any role | Includes `productCount` |
| `POST /categories` | admin | `{ name, description? }`. Names are unique, ignoring letter case |
| `PUT /categories/:id` | admin | Same body |
| `DELETE /categories/:id` | admin | `409` while products still use it |

---

## Products

### GET /products (any role)
Query: `search` (name or SKU), `categoryId`, `inStock` (`true`/`false`), `page`, `limit`.
Hidden products (`isActive: false`) are only listed for admins.

### GET /products/:id (any role)

**Product shape:**
```json
{
  "id": 1,
  "name": "Oak Dining Chair",
  "description": null,
  "sku": "FUR-CHAIR-OAK",
  "imageUrl": null,
  "isActive": true,
  "category": { "id": 1, "name": "Furniture" },
  "price": 89,
  "costPrice": 45,
  "stock": { "quantity": 40, "reorderLevel": 10, "isInStock": true, "isLowStock": false },
  "bulkPricingTiers": [ { "quantity": 10, "price": 80 }, { "quantity": 50, "price": 72 } ],
  "createdAt": "2026-10-01T06:15:56.867Z",
  "updatedAt": "2026-10-01T06:15:56.867Z"
}
```
`costPrice` is only included for admins.

### POST /products (admin)
```json
{
  "name": "Oak Dining Chair",
  "categoryId": 1,
  "price": 89,
  "costPrice": 45,
  "sku": "FUR-CHAIR-OAK",
  "description": "Optional",
  "imageUrl": "https://…",
  "isActive": true,
  "stock": 40,
  "reorderLevel": 10,
  "bulkPricingTiers": [ { "quantity": 10, "price": 80 } ]
}
```
Required: `name`, `categoryId`, `price`. The starting `stock` is logged as an "Initial stock" adjustment. Duplicate SKU returns `409`.

### PUT /products/:id (admin)
Same body **without `stock` or `reorderLevel`**. Stock changes go through `PATCH /inventory/:productId` so they're logged. If `bulkPricingTiers` is left out, the current tiers stay (and must still be valid for the new price).

### DELETE /products/:id (admin)
Soft delete: the product disappears everywhere, but sales history still refers to it.

---

## Bulk Pricing

Rules for tiers: quantity at least 2, no duplicate quantities, and each tier must be **cheaper** than the base price and than every smaller tier. At most 20 tiers.

| Method & path | Auth | Body / returns |
|---|---|---|
| `GET /pricing/tiers/:productId` | any role | `{ productId, basePrice, tiers }` |
| `PUT /pricing/tiers/:productId` | admin | `{ tiers: [ { quantity, price } ] }`, replaces all tiers |

---

## Inventory

### GET /inventory (any role)
Query: `lowStock` (`true` = at or below reorder level), `search`, `page`, `limit`. Sorted with the emptiest (relative to reorder level) first.

Item: `{ productId, productName, sku, quantity, reorderLevel, isLowStock, lastRestockedAt, updatedAt }`

### GET /inventory/:productId (any role)
The item plus `warnings` (e.g. `["Out of stock"]`) and the 20 most recent `recentAdjustments`: `{ id, quantity, reason, notes, adjustedBy, date }`.

### PATCH /inventory/:productId (admin)
```json
{ "quantity": -3, "reason": "Damage", "notes": "Dropped in storage", "reorderLevel": 5 }
```
- `quantity` is a change: positive adds, negative removes. Needs a `reason`: `Restock`, `Return`, `Damage`, `Recount` or `Manual adjustment`
- `reorderLevel` is optional; send it alone to change only the warning level
- Stock can never go below zero (`400`)
- When stock drops to the reorder level, or runs out, every admin gets a notification

---

## Sales

### POST /sales (admin, employee)
```json
{ "productId": 1, "quantity": 12, "notes": "Optional", "saleDate": "2026-09-30T14:00:00Z" }
```
The unit price comes from the product's bulk tiers for that quantity. Units leave stock in the same transaction (logged as a "Sale" adjustment). `saleDate` is optional (defaults to now) and can't be in the future. Hidden products can't be sold.

Returns `{ id, productId, productName, quantity, pricePerUnit, totalAmount, soldBy, saleDate, notes }`.

### GET /sales (admin)
Query: `startDate`, `endDate`, `productId`, `page`, `limit`. A date without a time includes that whole day (`endDate=2026-10-31` includes the 31st).

Returns `data: { sales: [...], totalRevenue }`, where `totalRevenue` covers every sale matching the filters, not just the page.

---

## Analytics (admin)

### GET /analytics/dashboard
Query: `days` (default 30, max 366).
```json
{
  "periodDays": 30,
  "totalSales": 24,
  "unitsSold": 51,
  "totalRevenue": 4310,
  "totalProfit": 2104,
  "topProducts": [ { "productId": 1, "productName": "…", "unitsSold": 10, "revenue": 890 } ],
  "lowStockItems": [ { "productId": 4, "productName": "…", "quantity": 1, "reorderLevel": 10 } ],
  "lowStockCount": 3,
  "recentSales": [ { "id": 24, "productName": "…", "quantity": 2, "totalAmount": 70, "saleDate": "…" } ],
  "inventoryValue": 4250
}
```
`totalProfit` only counts products with a cost price. `inventoryValue` uses cost price, or the sale price when cost is unknown.

### GET /analytics/revenue
Query: `period` (`daily` | `weekly` | `monthly`, default `daily`), `startDate`, `endDate`, `productId`. Defaults to the last 30 days / 12 weeks / 12 months. Periods with no sales are included as zero. Buckets are in UTC.

Returns `{ period, startDate, endDate, totalRevenue, points: [ { periodStart: "2026-09-01", revenue, unitsSold, salesCount } ] }`.

### GET /analytics/products/:productId
`{ productId, productName, salesCount, revenue, revenueLast12Months, currentStock, monthlyTrend, stockHistory }`

---

## Users (admin)

| Method & path | Body | Notes |
|---|---|---|
| `GET /users` | – | Query: `role`, `page`, `limit` |
| `POST /users` | `{ email, name, role, password }` | Password at least 8 characters. Duplicate email returns `409` |
| `PUT /users/:id` | any of `{ name, role, isActive, password }` | A new password, a role change or deactivation logs them out everywhere |
| `DELETE /users/:id` | – | Soft delete. You can't delete yourself |

The last active admin can't be demoted, deactivated or deleted (`409`).

---

## Notifications (any logged-in user)

| Method & path | Notes |
|---|---|
| `GET /notifications` | Query: `unreadOnly`, `page`, `limit`. Returns `data: { notifications, unreadCount }` |
| `PATCH /notifications/:id/read` | Only your own notifications |
| `POST /notifications/read-all` | |

A notification: `{ id, title, message, type, isRead, createdAt }`, where `type` is `low_stock` or `out_of_stock`.

---

## Favorites (any logged-in user)

| Method & path | Notes |
|---|---|
| `GET /favorites` | Your favorite products (full product objects), newest first |
| `GET /favorites/ids` | Just the product ids |
| `PUT /favorites/:productId` | Adding twice is fine |
| `DELETE /favorites/:productId` | |

---

## Reports

All report endpoints take `startDate` and `endDate` (required, ISO, end exclusive; a date-only `endDate` includes that whole day; at most 366 days). The comparison period is the same length immediately before, unless `summary` or `my-sales` is given an explicit `previousStartDate` and `previousEndDate` (both or neither), e.g. the same days last month or last calendar month.

Profit uses each sale's cost at the time of sale (`unit_cost`). Sales of products without a cost price are left out of cost, profit and margin; their revenue is reported as `revenueWithoutCost`.

| Method & path | Auth | Returns |
|---|---|---|
| `GET /reports/summary` | admin | `{ current, previous, change }`: totals for both periods and relative change (`0.12` = +12%, `null` when the previous value was 0) |
| `GET /reports/team` | admin | Per admin/employee, plus anyone who sold in the period: `{ userId, name, role, hasLeft, salesCount, unitsSold, revenue, profit, averageSale }`; `hasLeft` is true for people deactivated or removed since |
| `GET /reports/profit?groupBy=product\|category` | admin | `{ id, name, unitsSold, revenue, cost, profit, margin, hasUnknownCost }`, most profitable first; margin leaves out sales with no cost |
| `GET /reports/reorder-suggestions` | admin | Per active product: `{ productId, productName, quantity, reorderLevel, averageDailySales, daysLeft, suggestedOrder }`, soonest to run out first. No date range |
| `GET /reports/my-sales` | admin, employee | The caller's own `current` and `previous` `{ salesCount, unitsSold, revenue }` and their 10 latest `recentSales`. Never cost or profit |

Totals shape: `{ revenue, revenueWithoutCost, cost, profit, margin, unitsSold, salesCount }`.

Reorder maths: `averageDailySales` = units sold in the last 30 days ÷ 30; `daysLeft` = stock ÷ that, rounded down (`null` without recent sales); `suggestedOrder` = `max(0, ceil(average × 30 + reorderLevel − stock))`.

---

## Exports (admin)

CSV files (UTF-8 with BOM, opens in Excel). Errors still come back as JSON. The filename is in the `Content-Disposition` header. Pass `tz` (an IANA timezone such as `Europe/Dublin`, default `UTC`) so the filename and the Date column (`2026-09-01 00:30`) use local dates.

| Method & path | Contents |
|---|---|
| `GET /exports/sales.csv?startDate&endDate` | One row per sale: date, product, SKU, quantity, unit price, total, unit cost, profit, sold by, notes |
| `GET /exports/stock.csv` | One row per active product: name, SKU, category, stock, reorder level, price, cost, stock value, days left |
| `GET /exports/team.csv?startDate&endDate` | The team report |

---

## Activity (admin)

`GET /activity?userId&entityType&entityId&action&page&limit`: newest first.

- `action`: comma-separated exact actions or prefixes, e.g. `stock`, `sale.recorded`, `product,pricing,category`
- `entityType`: `product`, `category`, `user` or `sale`

Entry: `{ id, action, entityType, entityId, summary, details, createdAt, user: { id, name } | null }`.

Logged actions: `auth.logged_in`, `product.created`, `product.updated`, `product.deleted`, `pricing.updated`, `stock.adjusted`, `sale.recorded`, `category.created`, `category.updated`, `category.deleted`, `user.created`, `user.updated`, `user.deleted`. Passwords are never logged.

---

## Notes
- All timestamps are ISO 8601 in UTC
- Money is in euros, as numbers with up to two decimals
- Images are links (`imageUrl`); uploading files isn't built yet
- Every `POST`/`PUT`/`PATCH` body is JSON (`Content-Type: application/json`, max 1 MB)
