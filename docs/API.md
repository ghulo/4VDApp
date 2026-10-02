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

### GET /products/:id/price-history (admin)
Every price and cost change, newest first, read from the activity log: `[ { changedAt, changedBy, price: { from, to } | null, costPrice: { from, to } | null } ]`. The product's creation is the first entry, with `from: null`.

Every product also carries `promotion`: `{ id, name, percentOff, endsAt, price }` for the biggest running promotion (`price` is one unit after the discount), or `null`.

---

## Promotions (admin)

A percentage off (more than 0, at most 90) for **one product or one category**, between two dates. Dates are whole UTC days, both included: `startsAt` `"2026-10-01"` means from the start of that day, `endsAt` `"2026-10-07"` means until the end of that day (returned end-exclusive, as `2026-10-08T00:00:00Z`).

| Method & path | Body / returns |
|---|---|
| `GET /promotions` | All promotions, newest first: `{ id, name, percentOff, product, category, startsAt, endsAt, endedEarlyAt, status, createdBy, createdAt }`; `status` is `scheduled`, `running`, `finished` or `ended` (ended early) |
| `POST /promotions` | `{ name, percentOff, productId \| categoryId, startsAt, endsAt }`. `400` naming the products when the discount would take any of them below cost plus the minimum margin (products without a cost price aren't checked) |
| `POST /promotions/:id/end` | Ends a running promotion now, or cancels a scheduled one. `409` if it already ended |

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
- `quantity` is a change: positive adds, negative removes. Needs a `reason`: `Restock` or `Manual adjustment`. Returns, damage and recounts go through their own endpoints below, so losses are always valued and reviewed
- `reorderLevel` is optional; send it alone to change only the warning level
- Stock can never go below zero (`400`)
- When stock drops to the reorder level, or runs out, every admin gets a notification

---

## Sales

### POST /sales (admin, employee)
```json
{ "productId": 1, "quantity": 12, "notes": "Optional", "saleDate": "2026-09-30T14:00:00Z" }
```
The unit price comes from the product's bulk tiers for that quantity, or from the biggest running promotion when that is cheaper (discounts never stack; the sale stores `promotion_id`). Units leave stock in the same transaction (logged as a "Sale" adjustment). `saleDate` is optional (defaults to now) and can't be in the future. Hidden products can't be sold.

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
| `PUT /users/:id` | any of `{ name, role, isActive, password, monthlyTarget, commissionPercent }` | A new password, a role change or deactivation logs them out everywhere. `monthlyTarget` (euros) and `commissionPercent` (0–100) can be `null` to remove them |
| `DELETE /users/:id` | – | Soft delete. You can't delete yourself |

The last active admin can't be demoted, deactivated or deleted (`409`).

---

## Notifications (any logged-in user)

| Method & path | Notes |
|---|---|
| `GET /notifications` | Query: `unreadOnly`, `page`, `limit`. Returns `data: { notifications, unreadCount }` |
| `PATCH /notifications/:id/read` | Only your own notifications |
| `POST /notifications/read-all` | |

A notification: `{ id, title, message, type, isRead, createdAt }`, where `type` is `low_stock`, `out_of_stock`, `approval` (something waits for the owner), `approval_decision` (the owner decided on your request) or `test`.

### Push alerts

New notifications are also pushed to the person's phones and browsers, within about 5 seconds, by a background sender in the server. Alerts more than 15 minutes old are dropped instead of sent late. Each person chooses topics: admins get `stock` and `approvals`, employees get `decisions`, family members get none.

| Method & path | Body / returns |
|---|---|
| `GET /notifications/push` | `{ topics: [ { topic, enabled } ], deviceCount, webPushPublicKey }`; `webPushPublicKey` is null when the server has no Web Push keys |
| `PUT /notifications/push/preferences` | Any of `{ stock, approvals, decisions }` as booleans. Returns the settings |
| `POST /notifications/push/devices` | `{ kind: 'expo', token }` from the Android app, or `{ kind: 'web', endpoint, keys: { p256dh, auth } }` from a browser. A device belongs to whoever registered it last |
| `DELETE /notifications/push/devices` | `{ token }` (the Expo token or Web Push endpoint). The apps call this when switching off and when logging out |
| `POST /notifications/push/test` | Sends a test alert to all your devices, whatever your topics. `202` |

Devices that Expo or the browser report as gone are forgotten automatically.

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

Money comes from the `sales_ledger` view: sales on their sale date, plus approved returns as negative rows on the day they were approved. So a refund lowers revenue and profit in the period it was approved and never changes a past period. A restocked return takes back the refund and gives back the cost of the units, so a full refund lowers profit by that sale's margin. `salesCount` counts sales only.

| Method & path | Auth | Returns |
|---|---|---|
| `GET /reports/summary` | admin | `{ current, previous, change }`: totals for both periods and relative change (`0.12` = +12%, `null` when the previous value was 0) |
| `GET /reports/team` | admin | Per admin/employee, plus anyone who sold in the period: `{ userId, name, role, hasLeft, salesCount, unitsSold, revenue, refunds, profit, averageSale, monthlyTarget, commissionPercent, commission }`; `commission` is revenue after refunds × `commissionPercent` (`null` when none is set); refunds count against the person who made the sale; `hasLeft` is true for people deactivated or removed since |
| `GET /reports/profit?groupBy=product\|category` | admin | `{ id, name, unitsSold, revenue, cost, profit, margin, hasUnknownCost }`, most profitable first; margin leaves out sales with no cost |
| `GET /reports/reorder-suggestions` | admin | Per active product: `{ productId, productName, quantity, reorderLevel, averageDailySales, daysLeft, suggestedOrder, trend, lastSoldAt }`, soonest to run out first. No date range. `trend` is `rising`, `falling`, `steady` or `null` |
| `GET /reports/insights` | admin | What needs attention, most urgent first: `[ { kind, severity, title, detail, productId } ]`. `kind` is `sold_out`, `running_out` (within 7 days), `missing_stock` (count shortfalls and lost write-offs, last 30 days), `unusual_sale` (last 7 days, at least 5 units and 4× the product's usual sale), `below_cost` (last 7 days) or `dead_stock` (in stock, no sale in 60 days). `severity` is `urgent`, `warning` or `info` |
| `GET /reports/daily-summary` | admin | What tonight's summary would say right now: `{ title, message, salesLine }` |
| `GET /reports/my-sales` | admin, employee | The caller's `monthlyTarget` (or `null`), their own `current` and `previous` `{ salesCount, unitsSold, revenue, refunds }` and their 10 latest `recentSales` `{ id, productName, quantity, pricePerUnit, totalAmount, saleDate, returnedQuantity }`. Never cost or profit |

Totals shape: `{ revenue, refunds, revenueWithoutCost, cost, profit, margin, unitsSold, salesCount, stockLosses, lossUnitsWithoutCost }`. `revenue` is after refunds. `stockLosses` is the value at cost of approved write-offs plus approved count differences in the period; a surplus found in a count lowers it. `lossUnitsWithoutCost` counts lost units whose product had no cost price.

Forecast maths (`backend/src/services/reports/forecast.ts`): sales from the last 8 weeks, or since the product's first sale or creation if later (stretched to at least a week). Daily rate = (2 × last 2 weeks + the 6 before) ÷ 3, so recent weeks count double. Once a product has 3 sales, no single sale counts as more than 4× the usual size (at least 5 units), so one bulk order doesn't set the pace. With 4+ weeks and 14+ units, each weekday gets its own weight (busy Saturdays, quiet Mondays) in the shop's time zone (`SHOP_TIME_ZONE`, default `Europe/Budapest`). `daysLeft` walks forward day by day until stock can't cover a day's demand; `suggestedOrder` = demand over the next 30 days + `reorderLevel` − stock, rounded up.

### Daily summary

Every admin gets a `daily_summary` notification (and push alert, topic `summary`) once a day after `dailySummaryHour` (setting, default 20, shop time): today's sales and profit against the same weekday last week, the urgent warnings and how many others there are. The last day sent is stored as the `daily_summary_last_sent` setting, so restarts and extra servers don't send it twice.

---

## Returns, write-offs and stock counts

Employees start these; the owner approves. Admin actions never wait. Nothing touches stock or money until it is approved. Rejecting always needs `{ "note": "..." }` (up to 500 characters), which the employee sees. Deciding something that was already decided gives `409`.

**What waits for approval when an employee does it:** a refund above the refund limit, a return of a sale older than the return window, anything damaged, every write-off, and every count line that differs from what the system expected.

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /settings` | admin, employee | `{ refundApprovalLimit, returnWindowDays }` (defaults 50 and 14) |
| `PUT /settings` | admin | Change one or both |
| `POST /sales/:saleId/returns` | admin, employee (employees: own sales only, else `403`) | `{ quantity, condition: "resellable" \| "damaged", refundAmount?, notes? }`. `refundAmount` defaults to what was paid for those units and can't be more. Pending returns count against what is left to return |
| `GET /returns?status=pending\|approved\|rejected` | admin | `{ id, saleId, productId, productName, quantity, refundAmount, condition, notes, status, needsApprovalBecause, soldBy, saleDate, requestedBy, requestedAt, decidedBy, decidedAt, decisionNote }` |
| `POST /returns/:id/approve`, `POST /returns/:id/reject` | admin | Approving a resellable return puts the units back (stock reason `Return`). A damaged one creates an approved write-off instead |
| `POST /write-offs` | admin, employee | `{ productId, quantity, reason: "damaged" \| "lost" \| "expired" \| "other", notes? }`. Captures today's cost price |
| `GET /write-offs?status=` | admin | `{ id, productId, productName, quantity, reason, unitCost, value, returnId, notes, status, requestedBy, ... }` |
| `POST /write-offs/:id/approve`, `/reject` | admin | Approving removes the stock (reason `Write-off`); `409` if it is no longer there |
| `POST /stock-counts` | admin, employee | `{ categoryId? }` (none = whole shop). `409` if it overlaps an open or submitted count; the whole shop overlaps every category |
| `GET /stock-counts` | admin, employee | Open and submitted counts, then the 20 latest closed or cancelled |
| `GET /stock-counts/:id` | admin, employee | The count, `totals { products, counted, differences, pending, shortageValue }` and one line per product `{ productId, productName, sku, categoryName, countedQuantity, status, decisionNote, expectedQuantity, difference, value }`. Employees get no expected numbers, differences or values until the count is closed |
| `PUT /stock-counts/:id/lines/:productId` | admin, employee | `{ countedQuantity }`. Counting again replaces the line. Only while open (`409` after) |
| `POST /stock-counts/:id/submit` | admin, employee | Matching lines become `match`, the others `pending`. With no differences the count closes at once |
| `POST /stock-counts/:id/cancel` | the person who started it, or an admin | Only while open |
| `POST /stock-counts/:id/lines/:productId/approve`, `/reject` | admin | Approving applies counted − expected to today's stock (reason `Recount`), so sales since the count are kept. `409` if that would go below zero |
| `POST /stock-counts/:id/approve-all` | admin | `{ approved, failed: [{ productId, productName, message }] }` |
| `GET /approvals/summary` | admin | `{ returns, writeOffs, countLines, total }` waiting |
| `GET /approvals/mine` | admin, employee | The caller's own returns, write-offs and submitted counts from the last 30 days: `{ type, id, summary, status, decisionNote, requestedAt, decidedAt }` |

When something starts waiting, every admin gets a notification. When it is decided, the employee who asked gets one too.

`GET /sales` items gain `returnedQuantity` (returned or waiting for a decision).

---

## Assistant (admin)

Questions in plain words, answered by an AI service: Claude when `ANTHROPIC_API_KEY` is set (`ANTHROPIC_MODEL`, default `claude-sonnet-5-5` at low effort, or `claude-haiku-4-5`; `ANTHROPIC_WORKSPACE_ID` only for keys made outside a workspace), otherwise Google Gemini (`GEMINI_API_KEY`, `GEMINI_MODEL`), from a summary of the shop's own numbers: monthly totals for 12 months, sales per product over 30 and 90 days, stock with forecasts, the team this month and last, warnings, and running promotions. Staff names are swapped for "Person 1", "Person 2" before sending and put back in the answer. The AI service is behind one small interface (`backend/src/services/ai/aiProvider.ts`), so another provider can replace it.

| Method & path | Body / returns |
|---|---|
| `GET /assistant` | `{ enabled, provider }` |
| `POST /assistant/ask` | `{ question }` (3–500 characters) → `{ answer }`. 20 questions per person per 15 minutes. `503` with a readable message when it's switched off, over the free limit, or not answering |
| `POST /assistant/price-suggestions/:productId` | A suggested price from the product's price, cost, minimum price, bulk prices, sales pace and trend, sales at each unit price over 180 days, price changes, promotions, and similar products in its category (no staff names). Returns `{ productId, currentPrice, costPrice, minimumPrice, suggestedPrice, decision, confidence, summary, reasons, watchOut, provider }`; `decision` is `raise`, `lower` or `keep`. Never below `minimumPrice` (cost plus the minimum margin), and never applied automatically. Shares the 20-per-15-minutes limit |

---

## Exports (admin)

CSV files (UTF-8 with BOM, opens in Excel). Errors still come back as JSON. The filename is in the `Content-Disposition` header. Pass `tz` (an IANA timezone such as `Europe/Dublin`, default `UTC`) so the filename and the Date column (`2026-09-01 00:30`) use local dates.

| Method & path | Contents |
|---|---|
| `GET /exports/sales.csv?startDate&endDate` | One row per sale: date, product, SKU, quantity, unit price, total, unit cost, profit, sold by, notes, type. Approved returns are extra rows with type `Return`, negative quantity and amounts, dated when they were approved |
| `GET /exports/stock.csv` | One row per active product: name, SKU, category, stock, reorder level, price, cost, stock value, days left |
| `GET /exports/team.csv?startDate&endDate` | The team report |

---

## Activity (admin)

`GET /activity?userId&entityType&entityId&action&page&limit`: newest first.

- `action`: comma-separated exact actions or prefixes, e.g. `stock`, `sale.recorded`, `product,pricing,category`
- `entityType`: `product`, `category`, `user`, `sale`, `return`, `write_off`, `stock_count` or `settings`

Entry: `{ id, action, entityType, entityId, summary, details, createdAt, user: { id, name } | null }`.

Logged actions: `auth.logged_in`, `product.created`, `product.updated`, `product.deleted`, `pricing.updated`, `stock.adjusted`, `sale.recorded`, `category.created`, `category.updated`, `category.deleted`, `user.created`, `user.updated`, `user.deleted`. Passwords are never logged.

---

## Notes
- All timestamps are ISO 8601 in UTC
- Money is in euros, as numbers with up to two decimals
- Images are links (`imageUrl`); uploading files isn't built yet
- Every `POST`/`PUT`/`PATCH` body is JSON (`Content-Type: application/json`, max 1 MB)
