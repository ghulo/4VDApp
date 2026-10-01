# Returns, Stock Counts and Write-offs: Design

Piece 1 of the roadmap in `docs/ROADMAP.md`. It comes before the smart layer
because forecasts and "stock went missing" warnings are only trustworthy
once returns, counts and losses are recorded properly.

## Goal

The owner can trust the stock and money numbers:
- a sale can be undone in full or in part, and the money, profit and team
  numbers correct themselves;
- shelves can be counted, and differences are corrected only after the owner
  approves them;
- damaged, lost or expired stock leaves the system as a recorded loss, not a
  silent adjustment.

## Decisions (agreed 2026-10-01)

- **Employees start, the owner approves.** Employees record returns, counts
  and write-offs from the phone. Admin actions never need approval.
- **What waits for approval when an employee does it:**
  - a refund over the refund limit (setting, default €50);
  - a return of a sale older than the return window (setting, default 14 days);
  - any write-off, including a return marked damaged;
  - every count line that differs from what the system expected.
  Everything else by an employee goes through straight away.
- **Returns are their own records**, linked to the original sale. They count
  on the day they are approved: past periods never change. The refund comes
  off the original seller's numbers.
- **Each record carries its own status** (`pending`, `approved`, `rejected`).
  One Approvals inbox in the dashboard lists everything pending. Nothing
  touches stock or money until it is approved. Rejections need a reason,
  which the employee sees.
- **Count sessions**, for the whole shop or one category, counted one product
  at a time on the phone, without showing the expected number.
- **Settings page** in the dashboard for the refund limit and return window.
- **Employees can return only their own sales.** The owner can return any
  sale from the dashboard (e.g. a customer comes back on someone else's shift).
- **Manual stock reasons shrink to `Restock` and `Manual adjustment`.** Damage,
  returns and recounts now have proper flows, so losses are always valued and
  reviewed. Old adjustments keep their original reasons.

## Data model (migration `003_returns_counts_write_offs`)

All status columns are `VARCHAR(20)` with a `CHECK`, matching existing style.
Approval columns are the same on every table: `status`, `requested_by`,
`requested_at`, `decided_by`, `decided_at`, `decision_note`.

### `settings`
`key VARCHAR(100) PRIMARY KEY`, `value JSONB NOT NULL`, `updated_by INT REFERENCES users(id)`,
`updated_at TIMESTAMPTZ`. Seeded with `refund_approval_limit = 50` and
`return_window_days = 14`. Read through a `SettingsService` that falls back to
these defaults when a key is missing.

### `returns`
- `sale_id INT NOT NULL REFERENCES sales(id)`
- `quantity INT NOT NULL CHECK (quantity > 0)`
- `refund_amount DECIMAL(12,2) NOT NULL CHECK (refund_amount >= 0)`
- `condition VARCHAR(20) NOT NULL CHECK (condition IN ('resellable','damaged'))`
- `notes TEXT`, plus the approval columns.
- Index on `sale_id`, and on `status` for the inbox.

Rules, checked in the service while holding a `FOR UPDATE` lock on the sale row:
- `quantity` ≤ sale quantity − (approved + pending returns of that sale);
- `refund_amount` ≤ `quantity × price_per_unit` of the sale; it defaults to that.

### `write_offs`
- `product_id INT NOT NULL REFERENCES products(id)`
- `quantity INT NOT NULL CHECK (quantity > 0)`
- `reason VARCHAR(20) NOT NULL CHECK (reason IN ('damaged','lost','expired','other'))`
- `unit_cost DECIMAL(10,2)`: the product's cost price when reported, so the
  loss value doesn't change if the cost price is edited later
- `return_id INT REFERENCES returns(id)`: set when it comes from a damaged return
- `notes TEXT`, plus the approval columns.

### `stock_counts`
- `category_id INT REFERENCES categories(id)`: `NULL` means the whole shop
- `status VARCHAR(20) CHECK (status IN ('open','submitted','closed','cancelled'))`
- `started_by`, `started_at`, `submitted_by`, `submitted_at`, `closed_at`

Only one count may be open or submitted per scope, and a whole-shop count
overlaps every category. Enforced in the service inside a transaction that
first takes `pg_advisory_xact_lock` on a fixed key, so two people starting a
count at the same moment can't both succeed.

### `stock_count_lines`
- `count_id INT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE`
- `product_id INT NOT NULL REFERENCES products(id)`, `UNIQUE (count_id, product_id)`
- `counted_quantity INT NOT NULL CHECK (counted_quantity >= 0)`
- `expected_quantity INT NOT NULL`: stock at the moment the line was counted
- `unit_cost DECIMAL(10,2)`: cost price at that moment
- `counted_by`, `counted_at`
- `status VARCHAR(20)`, `NULL` until submitted, then `match`, `pending`,
  `approved` or `rejected`; `decided_by`, `decided_at`, `decision_note`.

Counting the same product again before submitting replaces the line and takes
a fresh `expected_quantity`.

### `sales_ledger` (view)
One place that turns sales and approved returns into money, so every report
agrees:

```sql
CREATE VIEW sales_ledger AS
  SELECT s.id AS sale_id, NULL::int AS return_id, s.product_id, s.sold_by,
         s.sale_date AS occurred_at, s.quantity_sold AS units,
         s.total_amount AS revenue, s.unit_cost,
         s.quantity_sold * s.unit_cost AS cost
  FROM sales s
  UNION ALL
  SELECT s.id, r.id, s.product_id, s.sold_by,
         r.decided_at, -r.quantity, -r.refund_amount, s.unit_cost,
         -r.quantity * s.unit_cost
  FROM returns r JOIN sales s ON s.id = r.sale_id
  WHERE r.status = 'approved';
```

Profit is `revenue − cost` where `unit_cost` is known, exactly as now. A
refund therefore takes back the revenue, and the cost of the returned units
comes back too. A damaged return also creates a write-off, which records the
lost goods as a stock loss. `salesCount` still counts sales only
(`return_id IS NULL`).

## Stock losses

`stockLosses` for a period is the value at cost of:
- approved write-offs, by `decided_at`: `quantity × unit_cost`;
- approved count lines, by `decided_at`: `(expected − counted) × unit_cost`.
  A surplus (counted more than expected) reduces the losses.

Lines and write-offs with no known cost are counted in `lossUnitsWithoutCost`,
the same way revenue without a cost is reported today.

## Backend

### New repositories
`SettingsRepository`, `ReturnRepository`, `WriteOffRepository`,
`StockCountRepository`, all added to `TransactionalRepositories`.

### New services
- **`SettingsService`**: `get()` returns
  `{ refundApprovalLimit, returnWindowDays }`; `update(input, userId)` saves
  and logs `settings.updated`.
- **`ReturnService`**:
  - `request(saleId, input, user)` locks the sale and validates. If it needs
    approval (see Decisions), it saves a `pending` return. Otherwise it saves
    it and approves it in the same transaction.
  - `approve(id, admin)`, `reject(id, admin, note)`.
  - Approving puts resellable units back with stock reason `Return` and note
    `Return #id`. For a damaged return it creates an approved write-off
    (`reason: damaged`, `return_id` set) instead of putting stock back.
- **`WriteOffService`**: `request(input, user)`, `approve`, `reject`.
  Approving removes the stock with reason `Write-off` and note
  `Write-off #id (damaged)`. Not enough stock at approval gives `409`.
- **`StockCountService`**:
  - `start(categoryId | null, user)`, `get(id, user)` and `list(user)`.
  - `countLine(id, productId, counted, user)` works only while the count is
    `open`.
  - `submit(id, user)`: lines that match become `match`, the others `pending`,
    and the count becomes `submitted`.
  - `cancel(id, user)`: only while `open`, by whoever started it or an admin.
  - `approveLine`, `rejectLine`, `approveAll(id, admin)`. Approving applies
    `counted − expected` as a change to the current stock, with reason
    `Recount` and note `Count #id`, so sales made since the line was counted
    are not lost. If that would take stock below zero, the line can't be
    approved (`409`, "stock changed, count it again"). Once no lines are
    pending, the count becomes `closed`.
- **`ApprovalService`**:
  - `summary()` returns the pending numbers for the inbox badge:
    `{ returns, writeOffs, countLines, total }`.
  - `mine(userId)` returns the employee's own returns, write-offs and
    submitted counts from the last 30 days, newest first. Each row:
    `{ type, id, summary, status, decisionNote, requestedAt }`.

All writes run in one transaction with their activity-log entries, as in
piece 0. New activity actions: `return.requested`, `return.approved`,
`return.rejected`, `write_off.requested`, `write_off.approved`,
`write_off.rejected`, `count.started`, `count.submitted`, `count.cancelled`,
`count.line_approved`, `count.line_rejected`, `settings.updated`.

**Notifications (in-app, using the existing table):**
- when something becomes pending, every admin gets "New return waiting for
  approval", or the write-off or count equivalent;
- when something is decided, the employee who asked gets "Your return of
  2 × Paint was approved", or "…rejected: <reason>".

Push delivery comes in piece 3.

### Endpoints

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /settings` | staff | Current limits, so the phone can say "needs approval" |
| `PUT /settings` | admin | Change limits |
| `POST /sales/:saleId/returns` | staff (employee: own sales only) | `{ quantity, condition, refundAmount?, notes? }` |
| `GET /returns?status=` | admin | List with sale, product, seller, requester |
| `POST /returns/:id/approve` | admin | |
| `POST /returns/:id/reject` | admin | `{ note }` required |
| `POST /write-offs` | staff | `{ productId, quantity, reason, notes? }` |
| `GET /write-offs?status=` | admin | |
| `POST /write-offs/:id/approve` and `/reject` | admin | |
| `POST /stock-counts` | staff | `{ categoryId? }` → the new count; `409` if the scope overlaps an open count |
| `GET /stock-counts` | staff | Open and submitted counts plus the last 20 closed |
| `GET /stock-counts/:id` | staff | Count and its products. Employees get no `expectedQuantity` until the count is closed |
| `PUT /stock-counts/:id/lines/:productId` | staff | `{ countedQuantity }` |
| `POST /stock-counts/:id/submit` | staff | |
| `POST /stock-counts/:id/cancel` | starter or admin | |
| `POST /stock-counts/:id/lines/:productId/approve` and `/reject` | admin | |
| `POST /stock-counts/:id/approve-all` | admin | Approves every pending line that can be applied, and reports the ones that couldn't |
| `GET /approvals/summary` | admin | Pending numbers |
| `GET /approvals/mine` | staff | The caller's own requests |

`GET /sales` gains `returnedQuantity` per sale, counting approved and pending
returns, so the UI knows what is left to return.

### Changes to existing code
- `ReportsRepository.totals`, `team` and `profitBy`, plus
  `SalesRepository.totals`, `topProducts` and `revenueByPeriod`, read
  `sales_ledger` instead of `sales`. Sales counts still come from sales only.
- The summary totals gain `refunds` (positive amount), `stockLosses` and
  `lossUnitsWithoutCost`. Team rows gain `refunds`. My-sales `current` and
  `previous` gain `refunds`, and their revenue is net of refunds.
- `exports/sales.csv` gets a `Type` column (`Sale` or `Return`), with return
  rows carrying negative units and amounts on their approval date.
- `MANUAL_STOCK_REASONS` becomes `['Restock', 'Manual adjustment']`.
  `Return`, `Write-off` and `Recount` become system reasons.
- `resetData` in the test helper truncates the new tables.

## Admin dashboard

- **Approvals** page and nav item, with a number badge from
  `/approvals/summary` that refreshes every minute. It has three sections:
  - returns: product, units, refund, seller, requester, the reason it needs
    approval, approve/reject;
  - write-offs: product, units, reason, value at cost, approve/reject;
  - counts: one row per submitted count with its differences, opening the
    count review.
  Rejecting asks for a reason in an inline field (no browser dialogs).
- **Stock counts** page: start a count (whole shop or a category), see open
  and recent counts. The count review shows expected, counted, difference,
  value and status per line, with approve/reject per line, **Apply all** and a
  total shortage or surplus.
- **Sales** page: a **Return** action per sale with units, condition, refund
  amount (prefilled) and a note. Sales show "2 of 5 returned" when relevant.
- **Inventory detail**: a **Write off** action (units, reason, note). The
  manual adjustment form loses the reasons that moved to proper flows.
- **Settings** page: refund limit and return window, with a short explanation
  of what each does.
- **Reports**: summary cards for refunds and stock losses, and a Refunds
  column in the team table.

## Mobile app

- **My sales**: each recent sale has a **Return** action opening a return
  screen with units, condition, refund amount (prefilled) and a note. Before
  sending, it says plainly whether this one will need approval and why, using
  `/settings`.
- **Product detail**: **Report damage or loss** → units, reason, note.
  It always needs approval for employees, and the screen says so.
- **Home**:
  - a **Stock count** tile ("1 count open" or "Start a count");
  - a **Your requests** section listing pending ones and anything decided in
    the last 7 days, including the rejection reason.
- **Counts screen**: open counts with progress, and **Start a count** with a
  scope picker. Opening one goes to the **Count screen**:
  - one product at a time, with name, SKU and category;
  - a large number field with −1 and +1 buttons;
  - **Next** and **Skip**, and "34 of 120 counted";
  - a list view to jump to any product;
  - **Submit count** at the end, which warns how many products were not
    counted.
  Counted numbers are sent to the server one line at a time, so a closed app
  loses nothing.

## Error handling

- Returning more than is left, a refund above the amount paid, or a write-off
  of more than is in stock → `400` with a plain message.
- Approving something that is no longer valid, because stock moved or it was
  already decided → `409` with what to do next.
- Counting in a count that is no longer open → `409` "This count was
  submitted or cancelled".
- An employee returning someone else's sale → `403`.

## Testing

Backend integration tests per service flow:
- Returns: auto-approve, and each of the four approval triggers. Partial
  returns and the remaining-quantity limit. Damaged returns create a
  write-off. Approval moves stock and reports. Rejecting changes nothing.
  An employee can't return someone else's sale.
- Write-offs: approve, reject, not enough stock.
- Counts: overlap rules, hidden expected numbers for employees, recount
  replacing a line, submit sorting matches from pending, approval applying a
  change after a later sale, approve-all, the count closing, cancel rules.
- Reports: a refund lowers revenue and profit on the day it's approved but
  not in the sale's period. Team refunds go to the seller. Stock losses
  include write-offs and count differences, and a surplus reduces them. The
  sales CSV includes return rows.
- Settings: defaults, update, admin only.
- Approvals summary and `mine`.

Admin: the existing tests, a build and lint. Mobile: typecheck.

## Out of scope

- Exchanges (return one product, take another): record it as a return plus a
  new sale.
- Returns without a recorded sale.
- Push notifications for approvals (piece 3).
- Barcode scanning while counting (piece 5).
- "Stock went missing" warnings from count patterns (piece 4).
