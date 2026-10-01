# Returns, Stock Counts and Write-offs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let sales be returned, shelves be counted and losses be written off, with employee actions waiting for the owner's approval and every report reflecting the result.

**Architecture:** Three new record types (returns, write-offs, count sessions with lines) each carry their own approval status. A `sales_ledger` view merges sales and approved returns, so every money report reads one source. Services follow the existing pattern: validate, then do all writes and the activity-log entry in one `TransactionManager.run`.

**Tech Stack:** Express 5, Kysely, PostgreSQL, Zod, Vitest and Supertest (backend); React, Vite and TanStack Query (admin); Expo React Native and React Navigation (mobile).

**Spec:** `docs/superpowers/specs/2026-10-01-returns-and-stock-counts-design.md`

## Global Constraints

- Approval triggers apply to employees only. Admin actions never wait.
- Defaults: `refund_approval_limit = 50` (euros), `return_window_days = 14`.
- Statuses: returns and write-offs use `pending | approved | rejected`. Counts use `open | submitted | closed | cancelled`. Count lines use `NULL` (not submitted) or `match | pending | approved | rejected`.
- Rejecting anything requires a non-empty `note` (max 500 chars).
- Write-off reasons are `damaged | lost | expired | other`. Return conditions are `resellable | damaged`.
- `MANUAL_STOCK_REASONS = ['Restock', 'Manual adjustment']`. System reasons add `Return`, `Write-off` and `Recount`.
- Every write runs in one transaction together with its activity-log entry.
- Copy is in plain English sentence case, with no browser `alert`, `confirm` or `prompt`.
- Commit messages are plain English (see the user's commit-message preference) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Two returns of the same sale at once:** together they must never exceed the units sold. The sale row is locked `FOR UPDATE` while validating (Task 3 test: "should count pending returns against what is left").
2. **A sale between counting a product and approving its line:** approval applies the difference, not the absolute number, so the sale isn't lost (Task 4 test: "should apply the difference so later sales are kept").
3. **Approving a write-off after the stock has already been sold:** `409`, not negative stock (Task 2 test: "should refuse to approve when the stock is no longer there").
4. **A refund approved in October for a September sale:** September's report is unchanged and October's goes down (Task 6 test: "should take a refund off the period it was approved in").
5. **Deciding twice** (double click, two admins): the second decision gets `409` (Task 2 and Task 3 tests: "should not decide twice").

---

## File map

**Backend**
- Create `src/database/migrations/003_returns_counts_write_offs.ts`: tables, view and seeded settings.
- Modify `src/database/migrations/index.ts`, `src/database/types.ts`, `src/constants/activity.ts` and `src/constants/stock.ts`.
- Create `src/constants/approvals.ts` with the status and reason lists.
- Create the repositories `SettingsRepository.ts`, `WriteOffRepository.ts`, `ReturnRepository.ts` and `StockCountRepository.ts`, and modify `TransactionManager.ts`.
- Create the services `SettingsService.ts`, `WriteOffService.ts`, `ReturnService.ts`, `StockCountService.ts` and `ApprovalService.ts`.
- Create `src/validators/approvalValidators.ts`.
- Create the controllers `settingsController.ts`, `returnsController.ts`, `writeOffsController.ts`, `stockCountsController.ts` and `approvalsController.ts`.
- Create `src/routes/approvalRoutes.ts`, which builds every new router, and modify `routes/index.ts` and `routes/operationsRoutes.ts` (sale returns).
- Modify `container.ts`, `ReportsRepository.ts`, `ReportsService.ts`, `SalesRepository.ts`, `SalesService.ts` and `ExportService.ts`.
- Tests: create `settings.test.ts`, `writeOffs.test.ts`, `returns.test.ts`, `stockCounts.test.ts` and `approvals.test.ts`; modify `reports.test.ts`, `exports.test.ts`, `catalog.test.ts` and `helpers/testApp.ts`.

**Admin**
- Modify `services/types.ts`, `services/api.ts`, `App.tsx` (routes) and `components/Layout.tsx` (nav and badge).
- Create the pages `ApprovalsPage.tsx`, `SettingsPage.tsx`, `StockCountsPage.tsx` and `StockCountDetailPage.tsx`.
- Create the components `ReturnForm.tsx` and `WriteOffForm.tsx`.
- Modify `SalesPage.tsx`, `InventoryDetailPage.tsx` and `ReportsPage.tsx`.

**Mobile**
- Modify `services/types.ts`, `services/api.ts`, `navigation/types.ts`, `navigation/RootNavigator.tsx`, `components/MySales.tsx`, `screens/HomeScreen.tsx` and `screens/ProductDetailScreen.tsx`.
- Create the screens `ReturnScreen.tsx`, `WriteOffScreen.tsx`, `CountsScreen.tsx` and `CountScreen.tsx`.

**Docs:** `docs/API.md`, `docs/DATABASE.md`, `docs/ROADMAP.md`.

---

### Task 1: Schema, settings and shared constants

**Files:** the migration, `migrations/index.ts`, `database/types.ts`, the constants files, `SettingsRepository`, `SettingsService`, `settingsController`, the settings routes in `approvalRoutes.ts`, `container.ts`, `TransactionManager.ts`, `helpers/testApp.ts`, and `tests/settings.test.ts`.

**Interfaces produced:**
- `SettingsService.get(): Promise<AppSettings>`, where `AppSettings = { refundApprovalLimit: number; returnWindowDays: number }`
- `SettingsService.update(input: Partial<AppSettings>, userId: number): Promise<AppSettings>`
- Kysely tables `settings`, `returns`, `write_offs`, `stock_counts` and `stock_count_lines`, and the view `sales_ledger`
- `APPROVAL_STATUSES`, `WRITE_OFF_REASONS`, `RETURN_CONDITIONS` and `COUNT_STATUSES` in `constants/approvals.ts`
- Activity actions as listed in the spec, plus entity types `return`, `write_off`, `stock_count` and `settings`

- [ ] **Step 1: Write the failing tests** in `tests/settings.test.ts`

```ts
describe('settings', () => {
  it('should start with the default limits', async () => {
    const response = await request(context.app).get('/api/settings').set(auth(employeeToken));
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ refundApprovalLimit: 50, returnWindowDays: 14 });
  });

  it('should let the admin change a limit and log it', async () => {
    const response = await request(context.app).put('/api/settings').set(auth(adminToken)).send({ refundApprovalLimit: 80 });
    const log = await context.db.selectFrom('activity_log').selectAll().where('action', '=', 'settings.updated').execute();
    expect(response.body.data).toEqual({ refundApprovalLimit: 80, returnWindowDays: 14 });
    expect(log).toHaveLength(1);
  });

  it('should not let employees change limits', async () => {
    const response = await request(context.app).put('/api/settings').set(auth(employeeToken)).send({ returnWindowDays: 99 });
    expect(response.status).toBe(403);
  });

  it('should reject nonsense values', async () => {
    const response = await request(context.app).put('/api/settings').set(auth(adminToken)).send({ returnWindowDays: -1 });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run tests/settings.test.ts`. Expected: FAIL (404s).
- [ ] **Step 3:** Write migration `003` with exactly the tables in the spec, plus:

```sql
CREATE INDEX idx_returns_sale ON returns(sale_id);
CREATE INDEX idx_returns_status ON returns(status);
CREATE INDEX idx_write_offs_status ON write_offs(status);
CREATE INDEX idx_count_lines_count ON stock_count_lines(count_id);
INSERT INTO settings (key, value) VALUES ('refund_approval_limit', '50'), ('return_window_days', '14');
CREATE VIEW sales_ledger AS ...  -- exactly as in the spec
```

`down` drops the view first, then the tables in reverse order. Add the Kysely table interfaces and a `SalesLedgerView` to `Database`. Make `resetData` truncate `settings`, `returns`, `write_offs`, `stock_counts` and `stock_count_lines`, then re-insert the two default settings. `SettingsService.get` maps the two keys and falls back to the defaults. The validator is `z.object({ refundApprovalLimit: z.number().min(0).max(100000).optional(), returnWindowDays: z.number().int().min(0).max(3650).optional() }).refine(non-empty)`. Routes: `GET /settings` (staff), `PUT /settings` (admin).
- [ ] **Step 4:** Run the settings tests, then the full suite. Expected: all pass.
- [ ] **Step 5:** Commit "Add settings for the refund limit and return window, and the tables for returns, counts and write-offs".

### Task 2: Write-offs

**Files:** `WriteOffRepository`, `WriteOffService`, `writeOffsController`, routes, `approvalValidators.ts` and `tests/writeOffs.test.ts`.

**Interfaces produced:**
- `WriteOffService.request(input: { productId; quantity; reason; notes }, user: PublicUser): Promise<WriteOffDto>`
- `WriteOffService.approve(id, admin)`, `.reject(id, admin, note)`, `.list({ status })`
- Exported helper `applyWriteOff(repos, writeOff, decidedBy): Promise<void>`, which removes the stock with reason `Write-off` and note `Write-off #id (damaged)`. Task 3 reuses it.
- `createWriteOffRecord(repos, { productId, quantity, reason, notes, returnId, requestedBy, status })` captures `unit_cost` from the product.
- `WriteOffDto = { id, productId, productName, quantity, reason, unitCost, value, notes, returnId, status, requestedBy: { id, name }, requestedAt, decidedBy, decidedAt, decisionNote }`
- `decisionNoteSchema = z.object({ note: trimmedString(500) })`

- [ ] **Step 1: Write the failing tests:**
  - "should write off straight away when the admin reports it": stock goes down, the status is `approved`, and `value = quantity × cost`.
  - "should wait for approval when an employee reports it": stock is unchanged, the status is `pending`, and admins get a notification.
  - "should take the stock away when approved": stock goes down, the employee gets a notification, and the activity log has `write_off.approved`.
  - "should leave stock alone when rejected, and keep the reason": rejecting without a note gives `400`.
  - "should refuse to approve when the stock is no longer there": stock 2, pending write-off of 2, a sale of 1, then approving gives `409`.
  - "should not decide twice": a second approve gives `409`.
  - "should not let family members report losses": `403`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. `decide` loads the row `FOR UPDATE` and throws `ConflictError('This write-off was already approved')` if it isn't pending. A not-enough-stock `ValidationError` from `applyStockChange` becomes `ConflictError('Only N left in stock. Count it again or reject this write-off.')`.
- [ ] **Step 4:** Run the write-off tests, then the full suite. Expected: pass.
- [ ] **Step 5:** Commit "Let staff report damaged, lost or expired stock, with employee reports waiting for approval".

### Task 3: Returns

**Files:** `ReturnRepository`, `ReturnService`, `returnsController`, the sale return route, `SalesRepository`, `SalesService` (`returnedQuantity`) and `tests/returns.test.ts`.

**Interfaces produced:**
- `ReturnService.request(saleId, { quantity, condition, refundAmount?, notes }, user): Promise<ReturnDto>`
- `.approve(id, admin)`, `.reject(id, admin, note)`, `.list({ status })`
- `ReturnDto = { id, saleId, productId, productName, quantity, refundAmount, condition, notes, status, needsApprovalBecause: string[], soldBy: {id,name}|null, requestedBy, requestedAt, decidedBy, decidedAt, decisionNote }`
- `SaleDto` gains `returnedQuantity: number`, counting pending and approved returns.

Approval reasons (`needsApprovalBecause`), worked out for employees only:
- `refund over €50` when `refundAmount > limit`;
- `sold more than 14 days ago` when `now − sale_date > window days`;
- `damaged item` when `condition === 'damaged'`.

- [ ] **Step 1: Write the failing tests:**
  - "should refund and restock straight away when nothing needs approval": an employee returns 1 of 2 from their own sale. Stock +1, status `approved`, refund = price paid.
  - "should wait for approval when the refund is over the limit": an €80 sale gives `pending` with `needsApprovalBecause: ['refund over €50']`.
  - "should wait for approval when the sale is older than the return window": the sale is dated 20 days ago.
  - "should turn a damaged return into a write-off when approved": stock unchanged, and an approved write-off with `returnId` exists.
  - "should count pending returns against what is left": a sale of 3, a pending return of 2, then a return of 2 gives `400` "Only 1 left to return".
  - "should not refund more than was paid": `400`.
  - "should allow a lower refund": refund 5 on a €10 sale gives `refundAmount: 5`.
  - "should not let employees return someone else's sale": `403`.
  - "should let the admin return anyone's sale straight away".
  - "should not decide twice": `409`.
  - "should show how much of a sale was returned": `GET /api/sales` gives `returnedQuantity: 1`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. `request` runs in a transaction: `sales.findByIdForUpdate`, the already-returned sum (pending and approved), validation, insert, then approve in the same transaction if nothing needs approval (decided_by = requester). Approving: resellable calls `applyStockChange(+qty, 'Return', 'Return #id')`. Damaged calls `createWriteOffRecord(... status 'approved', returnId)` and `applyWriteOff` is **not** called, because the units never came back into stock. Notifications and activity logging work as in Task 2.
- [ ] **Step 4:** Run the return tests, then the full suite.
- [ ] **Step 5:** Commit "Let sales be returned in full or in part, with big, old or damaged returns waiting for approval".

### Task 4: Stock counts

**Files:** `StockCountRepository`, `StockCountService`, `stockCountsController`, routes and `tests/stockCounts.test.ts`.

**Interfaces produced:**
- `StockCountService.start(categoryId: number | null, user)`, `.list(user)`, `.get(id, user)`
- `.countLine(id, productId, counted, user)`, `.submit(id, user)`, `.cancel(id, user)`
- `.approveLine(id, productId, admin)`, `.rejectLine(id, productId, admin, note)`, `.approveAll(id, admin): { approved: number; failed: Array<{ productId; productName; message }> }`
- `StockCountDto = { id, category: {id,name}|null, status, startedBy, startedAt, submittedAt, closedAt, totals: { products, counted, differences, pending, shortageValue }, lines: StockCountLineDto[] }`
- `StockCountLineDto = { productId, productName, sku, categoryName, countedQuantity: number|null, expectedQuantity?: number, difference?: number, value?: number|null, status, decisionNote }`
- `lines` covers every active product in scope, alphabetical. Uncounted ones have `countedQuantity: null`.

- [ ] **Step 1: Write the failing tests:**
  - "should start a count for a category and list its products".
  - "should refuse a second count that overlaps": a whole-shop count, then a category count gives `409`. Two different categories are allowed.
  - "should hide expected numbers from employees until the count is closed".
  - "should replace a line when counted again".
  - "should sort matches from differences on submit": a match becomes `match` and stock is untouched; a difference becomes `pending`; admins are notified.
  - "should apply the difference so later sales are kept": stock 10, counted 8 (expected 10), a sale of 1 (stock 9), approve gives stock 7 and reason `Recount`.
  - "should close the count when nothing is pending": `approveAll` closes it, and `shortageValue` is right.
  - "should refuse to approve a line that would make stock negative": `409`, reported in `approveAll().failed`.
  - "should not accept counts after submit": `409`.
  - "should only let the starter or an admin cancel an open count".
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. `start` takes `pg_advisory_xact_lock(4021)` before checking overlap. `countLine` checks the product is in scope, then upserts with `ON CONFLICT (count_id, product_id) DO UPDATE` and a fresh `expected_quantity` and `unit_cost`.
- [ ] **Step 4:** Run the count tests, then the full suite.
- [ ] **Step 5:** Commit "Add shelf counts that walk through products and send differences for approval".

### Task 5: Approvals summary and "my requests"

**Files:** `ApprovalService`, `approvalsController`, routes and `tests/approvals.test.ts`.

**Interfaces produced:**
- `GET /approvals/summary` returns `{ returns, writeOffs, countLines, total }`.
- `GET /approvals/mine` returns `Array<{ type: 'return'|'write_off'|'count', id, summary, status, decisionNote, requestedAt, decidedAt }>`, covering the last 30 days, newest first, at most 50.

- [ ] **Step 1: Write the failing tests:** the summary counts each kind, `mine` shows only the caller's items with the rejection note, the summary is admin only, and `mine` is staff.
- [ ] **Step 2–4:** Implement with three `count(*)` queries, and a `union all` query for `mine`. Run the tests.
- [ ] **Step 5:** Commit "Add an approvals summary for the owner and a list of each employee's own requests".

### Task 6: Reports, exports and stock reasons use the ledger

**Files:** `ReportsRepository`, `ReportsService`, `SalesRepository` (`totals`, `topProducts`, `revenueByPeriod`), `ExportService`, `constants/stock.ts`, the inventory validator, and the reports, exports and catalog tests.

**Interfaces produced:**
- Totals gain `refunds: number`, `stockLosses: number` and `lossUnitsWithoutCost: number`. Team rows gain `refunds`. My-sales totals gain `refunds`.
- Sales CSV gains a first column `Type`.

- [ ] **Step 1: Write the failing tests** (in `reports.test.ts` unless noted):
  - "should take a refund off the period it was approved in": a March sale, then a return approved in April (set `decided_at` directly). March is unchanged; April has revenue −100, refunds 100, salesCount 0.
  - "should lower profit only by the margin on a restocked return": profit after a full refund of a cost-60, price-100 sale is 0.
  - "should charge refunds to the original seller in the team report".
  - "should value stock losses from write-offs and count differences, and let a surplus reduce them".
  - "should show refunds in an employee's own numbers".
  - (exports) "should list approved returns as negative rows".
  - (catalog) "should no longer accept Damage as a manual stock reason": `400`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Rewrite the queries to read `sales_ledger l`:
  - `count(*) filter (where l.return_id is null)` for salesCount;
  - `sum(l.units)` for units;
  - `sum(l.revenue)` for revenue;
  - `-sum(l.revenue) filter (where l.return_id is not null)` for refunds;
  - `sum(l.cost) filter (where l.unit_cost is not null)` for cost;
  - `sum(l.revenue - l.cost) filter (where l.unit_cost is not null)` for profit;
  - `sum(l.revenue) filter (where l.unit_cost is null)` for revenue without cost.

  Add `stockLosses(range)`, which sums the approved write-offs and count lines. Team joins on `l.sold_by`.
- [ ] **Step 4:** Run the full suite, and update any older expectations that now gain the new fields.
- [ ] **Step 5:** Commit "Make every report and export count refunds and stock losses".

### Task 7: Admin dashboard

**Files:** as in the file map.

- [ ] **Step 1:** Add the types and API functions mirroring the DTOs above.
- [ ] **Step 2:** Settings page: a form with two number fields and **Save changes**, explaining what each limit does. It shows a "Saved" message.
- [ ] **Step 3:** Approvals page with three panels:
  - returns: product, units, refund, seller, requested by and when, and why it needs approval;
  - write-offs: product, units, reason, value;
  - counts: each count with its pending differences, linking to the count page.

  Each row has **Approve** and **Reject**. Reject shows an inline reason field and a **Reject** confirm button. Errors use `ErrorNotice`. The nav item is "Approvals" with a badge from `/approvals/summary` (`refetchInterval: 60_000`).
- [ ] **Step 4:** Stock counts page with **Start a count** (scope select) and a table of counts (scope, status, progress, started by). The detail page lists the lines with expected, counted, difference, value and status, Approve/Reject per pending line, **Apply all**, the shortage total, and **Cancel count** while open.
- [ ] **Step 5:** Sales page: a **Return** button per sale opens `ReturnForm` inline (units, condition, refund prefilled to units × price, note). Show "N returned" when `returnedQuantity > 0`. Hide **Return** when everything has been returned.
- [ ] **Step 6:** Inventory detail: a **Write off** button opens `WriteOffForm`. The manual reasons list shrinks to the two remaining reasons.
- [ ] **Step 7:** Reports: add Refunds and Stock losses cards to the summary, and a Refunds column to the team table.
- [ ] **Step 8:** Run `npx tsc -b`, `npm run lint`, `npx vitest run` and `npm run build`. All must pass.
- [ ] **Step 9:** Commit "Add approvals, stock counts, returns, write-offs and settings to the admin dashboard".

### Task 8: Mobile app

**Files:** as in the file map.

- [ ] **Step 1:** Add the types and API functions (`settingsApi.get`, `returnsApi.request`, `writeOffsApi.request`, `countsApi.*`, `approvalsApi.mine`).
- [ ] **Step 2:** `ReturnScreen` (modal, params `{ saleId, productName, quantity, totalAmount, returnedQuantity }`):
  - units stepper, condition choice, refund (prefilled) and a note;
  - a live line saying "This return goes through straight away" or "This return needs the owner's approval because the refund is over €50";
  - **Return** submits.

  `MySales` rows get a **Return** button.
- [ ] **Step 3:** `WriteOffScreen` (modal, params `{ productId, productName }`): units, reason chips, a note, and the line "The owner approves this before it leaves stock" for employees. Product detail gets a **Report damage or loss** button for staff.
- [ ] **Step 4:** `CountsScreen`: open counts with progress and a **Start a count** scope picker (Whole shop and the categories). `CountScreen`:
  - one product per view, with a large numeric input, −1 and +1, **Next** and **Skip**, and "N of M counted";
  - a **List** toggle that jumps to a product;
  - **Submit count**, with an inline warning showing the number of uncounted products and a confirm button.

  Each line saves on **Next**.
- [ ] **Step 5:** Home: a **Stock count** tile ("1 count open" or "Start a count"), and a **Your requests** section from `/approvals/mine` (pending, plus anything decided in the last 7 days, with the rejection note).
- [ ] **Step 6:** Run `npx tsc --noEmit`. It must pass.
- [ ] **Step 7:** Commit "Add returns, damage reports and shelf counts to the mobile app".

### Task 9: Docs and final verification

- [ ] **Step 1:** `API.md`: the new endpoints table and the changed report fields. `DATABASE.md`: the new tables and the view. `ROADMAP.md`: piece 1 Done.
- [ ] **Step 2:** Run the full backend suite, the admin tests, build and lint, and the mobile typecheck.
- [ ] **Step 3:** Commit "Document returns, stock counts and write-offs".
- [ ] **Step 4:** Run one fresh review of the whole branch, fix what matters, then merge into `main`, push and delete the branch.
