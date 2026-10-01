# Team & Profit Reports: Design

Sub-project 1 of 4 in the expansion agreed on 2026-10-01:
1. **Team & profit reports** (this document)
2. Push notifications (PC and phone)
3. Suppliers, purchase orders, invoice scanning, barcode scanning, image storage
4. Online store integration

## Goal

Let the admin see how much money the business makes and who is making it, and let employees see their own sales, without anyone having to export data and work it out by hand.

Success means:
- The admin can pick any period and see revenue, profit, margin and units, compared with the period before.
- The admin can see each team member's sales and profit for that period.
- The admin can see which products and categories make the most profit, and which have no cost price (so their profit is unknown).
- The admin knows roughly when each product will run out and how many to reorder.
- The admin can export sales, stock and the team report to open in Excel.
- The admin can see who changed what, and when.
- An employee can see their own sales for this month and last month on their phone, and nothing about other people or profit.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| How profit is calculated | Revenue minus the product's cost price **at the time of the sale** | Today the current cost is used, so a cost change rewrites history |
| Existing sales | Fill `unit_cost` from the product's current cost price | Best information available. Documented as approximate for sales before this change |
| Products without a cost price | Excluded from profit and margin; their revenue is reported separately as "revenue without cost" | Mixing them in would overstate profit |
| Comparison period | The same length of time immediately before the selected period | Works for any custom range, not just months |
| Period boundaries | The client sends exact start and end instants. The admin dashboard and mobile app compute "this month" etc. in the device's local time | Avoids guessing the business timezone on the server. Daily chart buckets stay UTC (existing behaviour) |
| Employee visibility | Employees see only their own sales count, units and revenue. Never profit, cost or other people | Option A, chosen by the user |
| Activity log scope | Changes to products, prices, stock, sales, categories and users, plus logins | These are the things worth answering "who did this?" for. Page views and reads are not logged |
| CSV format | UTF-8 with BOM, comma separated. Cells starting with `= + - @` get a leading `'` | The BOM makes Excel show € and accents correctly; the prefix blocks formula injection |

## Data model changes (migration `002_reports_and_activity`)

### `sales.unit_cost`
```sql
ALTER TABLE sales ADD COLUMN unit_cost DECIMAL(10, 2) CHECK (unit_cost >= 0);
UPDATE sales s SET unit_cost = p.cost_price FROM products p WHERE p.id = s.product_id;
```
`NULL` means the cost was unknown when sold. `SalesService.record` copies `products.cost_price` into it.

### `activity_log` (new)
```sql
CREATE TABLE activity_log (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),           -- who did it (NULL for the system)
  action VARCHAR(50) NOT NULL,                -- e.g. 'product.updated'
  entity_type VARCHAR(30),                    -- 'product', 'category', 'user', 'sale'
  entity_id INT,
  summary TEXT NOT NULL,                      -- readable sentence, e.g. 'Changed price of Oak Chair from €89 to €95'
  details JSONB,                              -- before/after values where useful
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_log_created ON activity_log (created_at DESC);
CREATE INDEX idx_activity_log_user ON activity_log (user_id);
CREATE INDEX idx_activity_log_entity ON activity_log (entity_type, entity_id);
```

**Actions logged:** `auth.logged_in`, `product.created`, `product.updated`, `product.deleted`, `pricing.updated`, `stock.adjusted`, `sale.recorded`, `category.created`, `category.updated`, `category.deleted`, `user.created`, `user.updated`, `user.deleted`.

`product.updated` records only the fields that changed (before → after) in `details`, and the summary names the most important change (price first). Entries are written inside the same transaction as the change wherever the change already uses one, so a rolled-back change leaves no log entry.

## Backend

New code follows the existing layers (route → controller → service → repository).

### Repositories
- `ReportsRepository`: the aggregate SQL for summary, team and profit breakdown, plus sales velocity for reorder suggestions. Read-only.
- `ActivityLogRepository`: `create(entry)` and `findMany(filters)`. Also added to `TransactionalRepositories`.

### Services
- `ReportsService`: summary with comparison, team, profit breakdown, reorder suggestions, "my sales".
- `ActivityLogService`: list entries with filters. Writing goes through a small `recordActivity(repos, entry)` helper that the existing services call.
- `ExportService`: turns report and list results into CSV text, via a pure, unit-tested `toCsv(rows, columns)` helper.

### Endpoints

All `/api/reports/*`, `/api/exports/*` and `/api/activity` endpoints are admin only. Query parameters `startDate` and `endDate` are required ISO date-times on report endpoints, end exclusive. The range can be at most 366 days.

**`GET /api/reports/summary?startDate&endDate`**
```json
{
  "current":  { "revenue": 4310, "revenueWithoutCost": 120, "cost": 2086, "profit": 2104, "margin": 0.502, "unitsSold": 51, "salesCount": 24 },
  "previous": { "revenue": 3850, "...": "same fields" },
  "change":   { "revenue": 0.119, "profit": 0.08, "unitsSold": -0.04, "salesCount": 0.09 }
}
```
`margin` is profit ÷ revenue from sales whose cost is known. `change` is relative (0.119 = +11.9%) and `null` when the previous value was 0.

**`GET /api/reports/team?startDate&endDate`**
One row per active admin or employee, plus anyone who made a sale in the period even if they've since been removed. Sorted by revenue, highest first:
`{ userId, name, role, salesCount, unitsSold, revenue, profit, averageSale }`. People with no sales are included with zeros.

**`GET /api/reports/profit?startDate&endDate&groupBy=product|category`**
Rows sorted by profit, highest first: `{ id, name, unitsSold, revenue, cost, profit, margin, hasUnknownCost }`. `hasUnknownCost` is true when any of the group's sales had no cost; those sales are left out of `cost`, `profit` and `margin`.

**`GET /api/reports/reorder-suggestions`**
For every active product:
- `averageDailySales`: units sold in the last 30 days ÷ 30
- `daysLeft`: stock ÷ average, rounded down. `null` when nothing sold in 30 days
- `suggestedOrder`: `max(0, ceil(averageDailySales × 30 + reorderLevel − stock))`

Returns `{ productId, productName, quantity, reorderLevel, averageDailySales, daysLeft, suggestedOrder }`, sorted by `daysLeft` with soonest first and `null` last.

**`GET /api/reports/my-sales?startDate&endDate`** (admin and employee)
The caller's own `{ salesCount, unitsSold, revenue }` for the period and the period before it, plus their 10 most recent sales in the period: `{ id, productName, quantity, totalAmount, saleDate }`. No cost or profit fields.

**`GET /api/exports/sales.csv?startDate&endDate`**: one row per sale: date, product, SKU, quantity, unit price, total, unit cost, profit, sold by, notes.
**`GET /api/exports/stock.csv`**: one row per active product: name, SKU, category, stock, reorder level, price, cost, stock value, days left.
**`GET /api/exports/team.csv?startDate&endDate`**: the team report rows.

Each export responds with `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="4vd-sales-2026-09-01-to-2026-09-30.csv"`. These are the only endpoints that don't return the JSON envelope; errors still return JSON.

**`GET /api/activity?userId&entityType&entityId&action&page&limit`**
Newest first: `{ id, action, entityType, entityId, summary, details, createdAt, user: { id, name } | null }`.

### Changes to existing code
- `SalesService.record` saves `unit_cost` and logs `sale.recorded`.
- `ProductService`, `PricingService`, `InventoryService`, `CategoryService`, `UserService` and `AuthService.login` record their activity.
- `AnalyticsService.dashboard` profit switches to `sales.unit_cost`, so it agrees with the reports.

## Admin dashboard

- **Reports page** (new sidebar item between Sales and Products):
  - A period picker: This month, Last month, Last 30 days, This year, Custom (two date inputs). The choice is kept in the URL
  - The summary: revenue as the one hero figure, with profit, margin and units beside it. Each figure shows its change against the previous period in words, e.g. "up 12% on the previous period"
  - A team table and a profit table with a Product/Category switch. Rows with unknown costs say so
  - Export buttons for sales, stock and team (downloaded through the authenticated API, saved as files)
- **Stock page:** a new "Runs out in" column ("about 9 days", "No recent sales") and a "Reorder" column with the suggested quantity. Both come from the reorder suggestions endpoint, joined by product id. The low-stock filter keeps working as it does now.
- **Activity page** (new sidebar item at the bottom of the main list): newest first, filterable by person and by kind of change (products, stock, sales, people, logins), paginated. Each row shows the summary sentence, who and when.

## Mobile app

- **Account tab, employees and admins only:** a "My sales" section with this month's sales count, units and revenue, a comparison with last month, and the 10 most recent sales. Pull to refresh. Family members don't see the section.

## Error handling

- Missing or invalid dates, `endDate` before `startDate`, or a range over 366 days: `400` with a message naming the problem.
- Unknown `groupBy`: `400`.
- Employees calling admin report, export or activity endpoints: `403`.
- Activity logging failing makes the whole change fail and roll back. We'd rather refuse a change than have a gap in the log.

## Testing

Integration tests (real test database), in `tests/reports.test.ts` and `tests/activity.test.ts`:
- A sale saves the cost at the time of sale; changing the product's cost afterwards does not change that sale's profit.
- Summary totals, margin, revenue without cost, and the comparison with the previous period (including `null` change from zero).
- Team rows: per-person totals, zero rows for people with no sales, sorting.
- Profit by product and by category, including the unknown-cost flag.
- Reorder maths: average, days left, suggested quantity, and `null` for no recent sales.
- My-sales only returns the caller's own sales and contains no profit fields; family gets `403`.
- Activity is logged for each listed action with the right user and summary; a failed stock adjustment logs nothing.
- CSV exports: headers, row content, the BOM, and the formula-injection prefix.

Unit tests for `toCsv`, the reorder calculation, and the relative-change calculation.

## Out of scope (later sub-projects)
- Notifications about reports (sub-project 2).
- Supplier costs from invoices updating cost prices (sub-project 3).
- Sales from the online store showing up in the team report (sub-project 4); the report will show them under a "Online store" row once that exists.
