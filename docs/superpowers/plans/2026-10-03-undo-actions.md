# Undo People's Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From any person's activity log, the people who run the shop can undo a mistaken sale, return, write-off, count correction or stock change, revert a product, price or settings edit, and restore any of these. Every step asks for confirmation first and is fully logged.

**Architecture:** Undo is keyed by the **activity log entry** the person sees: `POST /api/activity/:id/undo` and `POST /api/activity/:id/restore`. The server maps the entry to what it changed. For a sale, return, write-off or count line it marks that row (`undone_at/by`, `undo_note`) and applies a compensating stock change. For a manual stock change or an edit it marks the activity entry itself and applies the old values through the existing services. Money reports read `sales_ledger`, which leaves out undone rows, so every report agrees on its own. The dashboard gets a per-person Activity page with a timeline, an inline confirmation and Restore, in English and Albanian.

**Tech Stack:** Express + Kysely + PostgreSQL (`backend/`), React 19 + Vite (`admin/`), Expo / React Native (`mobile/`), Vitest everywhere.

**Spec:** `docs/superpowers/specs/2026-10-03-undo-actions-design.md`

## Global Constraints

- Hierarchy (spec): the Developer may undo or revert anyone's actions; the Owner and Admins may undo **employees'** actions and **their own**; Employees and Family may undo nothing. One function, `canUndo`, enforces it on the server.
- Confirmation before every Undo and Restore, showing the effect; an optional reason (`note`, max 500 chars).
- Nothing is deleted: originals stay, crossed out; undo and restore are new activity entries.
- Logging (spec): who, when (date and time), what changed (before → after, quantities, amounts), whose entry it was (with its id), and the reason.
- An undone sale leaves the money totals **on the day it was made**.
- Edits: only the latest change to the same fields of the same thing can be reverted ("Changed again since · revert the newer change first").
- Stock never goes negative; doing something twice is refused ("This was already undone by …").
- The person whose entry was undone gets an alert in their own language (server catalogue `backend/src/i18n/messages.ts`).
- UI: the existing component kit and DESIGN.md tokens, every word from the en/sq catalogues (the hard-coded-text guard must pass), states for loading, empty, error, busy and disabled.
- Commit messages: plain English (user's rule). Merge into `main`, push, delete the branch when done (user's rule).

## Review Focus

1. **Two people undo the same entry at the same moment:** exactly one succeeds, the other gets "already undone". Test: Task 3, concurrent undo.
2. **Undoing a sale that was partly returned and the return was rejected:** allowed (a rejected return doesn't block); a pending or approved one blocks. Test: Task 3.
3. **Restoring a sale when the product has since sold out:** refused with "Only 0 left in stock", nothing changes. Test: Task 3.
4. **Reverting a price edit after the product was deleted:** refused with a clear message, not a 500. Test: Task 4.
5. **An undone sale must vanish from the employee's commission and target figures too** (the team report reads the ledger). Test: Task 1.

---

## File Structure

**Backend**
- `src/database/migrations/010_undo.ts`: undo columns, new `sales_ledger` view.
- `src/services/undo/undoRules.ts`: `canUndo`, `undoTargetOf(entry)` (pure, unit-tested).
- `src/services/undo/UndoService.ts`: undo and restore for every kind, in transactions.
- `src/services/undo/editReverts.ts`: revert and restore of product, pricing, settings, reorder-level and promotion edits.
- `src/controllers/activityController.ts`, `src/routes/activityRoutes.ts`, `src/validators/activityValidators.ts`: the two endpoints.
- `src/services/ActivityLogService.ts`: entries carry `undo` state.
- `src/i18n/messages.ts`: undo alert texts (en/sq).
- Report and insight queries: exclude undone rows.

**Dashboard (`admin/src`)**
- `pages/PersonActivityPage.tsx` (route `/people/:id`).
- `components/activity/ActivityTimeline.tsx`, `components/activity/UndoConfirm.tsx`, `components/activity/activityText.ts` (effect wording, unit-tested).
- `pages/ActivityPage.tsx` uses the timeline; `pages/UsersPage.tsx` gets the Activity link.
- `i18n/en.ts`, `i18n/sq.ts`: `undo` section.

**Team app (`mobile/src`)**: "Your requests" shows undone sales and write-offs with the reason.

---

### Task 1: Undo columns, and reports that ignore undone rows

**Files:**
- Create: `backend/src/database/migrations/010_undo.ts`
- Modify: `backend/src/database/migrations/index.ts`, `backend/src/database/types.ts` (Sales/Returns/WriteOffs/StockCountLines/ActivityLog tables), `backend/src/repositories/ReportsRepository.ts` (lines ~131, ~135, ~214, ~229, ~240, ~251, ~267), `backend/src/repositories/InsightsRepository.ts` (~41, ~65, ~70, ~88, ~92)
- Test: `backend/tests/undoReports.test.ts`

**Interfaces:**
- Produces: columns `undone_at TIMESTAMPTZ NULL`, `undone_by INT NULL REFERENCES users(id)`, `undo_note TEXT NULL` on `sales`, `returns`, `write_offs`, `stock_count_lines`, `activity_log`; `sales_ledger` leaves out rows where the sale or the return is undone.

- [ ] **Step 1: Failing test.** Record two sales through the API, set `undone_at = now()` on one directly in SQL, then assert that `GET /api/reports/summary` for today counts only the other, that `GET /api/reports/team` gives the seller one sale, and that the daily summary's sales line says 1 sale.

```ts
it('should leave an undone sale out of every money total', async () => {
  const productId = await createTestProduct(context, adminToken, { price: 100, stock: 10 });
  const sell = () => request(context.app).post('/api/sales').set(auth(employeeToken)).send({ productId, quantity: 1 });
  const first = await sell();
  await sell();
  await context.db.updateTable('sales').set({ undone_at: new Date() }).where('id', '=', first.body.data.id).execute();

  const summary = await request(context.app).get('/api/reports/summary').query(today()).set(auth(adminToken));
  const team = await request(context.app).get('/api/reports/team').query(today()).set(auth(adminToken));

  expect(summary.body.data.current.revenue).toBe(100);
  expect(team.body.data.find((p: { role: string }) => p.role === 'employee').salesCount).toBe(1);
});
```
(`today()` returns `{ startDate, endDate }` for the current day as ISO strings.)

- [ ] **Step 2: Run** `cd backend && npx vitest run tests/undoReports.test.ts`. Expected: FAIL (column `undone_at` does not exist).
- [ ] **Step 3: Migration.**

```ts
import { type Kysely, sql } from 'kysely';

const TABLES = ['sales', 'returns', 'write_offs', 'stock_count_lines', 'activity_log'];

/** Undo: a row can be marked undone (and restored) instead of deleted, so history stays. */
export async function up(db: Kysely<unknown>): Promise<void> {
  for (const table of TABLES) {
    await sql`ALTER TABLE ${sql.table(table)}
      ADD COLUMN undone_at TIMESTAMPTZ,
      ADD COLUMN undone_by INT REFERENCES users(id),
      ADD COLUMN undo_note TEXT`.execute(db);
  }
  await sql`DROP VIEW IF EXISTS sales_ledger`.execute(db);
  await sql`CREATE VIEW sales_ledger AS
    SELECT s.id AS sale_id, NULL::int AS return_id, s.product_id, s.sold_by,
           s.sale_date AS occurred_at, s.quantity_sold AS units,
           s.total_amount AS revenue, s.unit_cost, s.quantity_sold * s.unit_cost AS cost
    FROM sales s
    WHERE s.undone_at IS NULL
    UNION ALL
    SELECT s.id, r.id, s.product_id, s.sold_by,
           r.decided_at, -r.quantity, -r.refund_amount, s.unit_cost, -r.quantity * s.unit_cost
    FROM returns r JOIN sales s ON s.id = r.sale_id
    WHERE r.status = 'approved' AND r.undone_at IS NULL AND s.undone_at IS NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // The previous view definition from 003, then drop the columns.
  await sql`DROP VIEW IF EXISTS sales_ledger`.execute(db);
  await sql`CREATE VIEW sales_ledger AS
    SELECT s.id AS sale_id, NULL::int AS return_id, s.product_id, s.sold_by,
           s.sale_date AS occurred_at, s.quantity_sold AS units,
           s.total_amount AS revenue, s.unit_cost, s.quantity_sold * s.unit_cost AS cost
    FROM sales s
    UNION ALL
    SELECT s.id, r.id, s.product_id, s.sold_by,
           r.decided_at, -r.quantity, -r.refund_amount, s.unit_cost, -r.quantity * s.unit_cost
    FROM returns r JOIN sales s ON s.id = r.sale_id
    WHERE r.status = 'approved'`.execute(db);
  for (const table of TABLES) {
    await sql`ALTER TABLE ${sql.table(table)} DROP COLUMN undone_at, DROP COLUMN undone_by, DROP COLUMN undo_note`.execute(db);
  }
}
```
Register as `'010_undo': undo` in `migrations/index.ts`. Add `undone_at: Date | null; undone_by: number | null; undo_note: string | null;` to the five table interfaces in `types.ts`.

- [ ] **Step 4: Direct queries.** Add `and s.undone_at is null` (or `.where('undone_at', 'is', null)`) to every direct `sales` read in `ReportsRepository` and `InsightsRepository` listed above. Add `and w.undone_at is null` / `and l.undone_at is null` to the write-off and count-line parts of `stockLosses` and `missingStock`. Leave `SalesRepository.list` (line ~46) and `recentSalesBy` (~251) **unfiltered** but select `s.undone_at` so lists can show undone sales crossed out (Task 6/8 use it). `ReturnRepository.lockSale` (~93) refuses an undone sale: add `undone_at` to its select, and in `ReturnService.request` throw `ConflictError('This sale was undone, so it can't be returned')` when set.
- [ ] **Step 5: Run** the test and the full suite: `npx vitest run tests/undoReports.test.ts && npm test`. Expected: PASS.
- [ ] **Step 6: Commit:** `git commit -m "feat: Undone sales and requests drop out of every report"`

### Task 2: Who may undo what, and what an entry undoes

**Files:**
- Create: `backend/src/services/undo/undoRules.ts`
- Test: `backend/tests/undoRules.test.ts`

**Interfaces:**
- Produces:
  - `canUndo(actor: { id: number; role: UserRole }, owner: { id: number; role: UserRole } | null): boolean`
  - `type UndoKind = 'sale' | 'return' | 'write_off' | 'count_line' | 'stock' | 'product_edit' | 'pricing_edit' | 'settings_edit' | 'reorder_edit' | 'promotion'`
  - `undoTargetOf(entry: { action: string; entity_id: number | null; details: Record<string, unknown> | null; id: number }): { kind: UndoKind; id: number; productId?: number } | null`

- [ ] **Step 1: Failing tests.**

```ts
import { describe, expect, it } from 'vitest';
import { canUndo, undoTargetOf } from '../src/services/undo/undoRules.js';

const as = (id: number, role: 'developer' | 'admin' | 'owner' | 'employee' | 'family') => ({ id, role });

describe('canUndo', () => {
  it('should let the developer undo anyone', () => {
    for (const role of ['developer', 'admin', 'owner', 'employee'] as const) expect(canUndo(as(1, 'developer'), as(2, role))).toBe(true);
  });
  it('should let admins and the owner undo employees and themselves only', () => {
    expect(canUndo(as(1, 'admin'), as(2, 'employee'))).toBe(true);
    expect(canUndo(as(1, 'owner'), as(1, 'owner'))).toBe(true);
    expect(canUndo(as(1, 'admin'), as(2, 'owner'))).toBe(false);
    expect(canUndo(as(1, 'owner'), as(2, 'admin'))).toBe(false);
    expect(canUndo(as(1, 'admin'), as(2, 'developer'))).toBe(false);
  });
  it('should let employees and family undo nothing', () => {
    expect(canUndo(as(1, 'employee'), as(1, 'employee'))).toBe(false);
    expect(canUndo(as(1, 'family'), as(2, 'employee'))).toBe(false);
  });
  it('should let only the developer undo entries whose person was removed', () => {
    expect(canUndo(as(1, 'developer'), null)).toBe(true);
    expect(canUndo(as(1, 'admin'), null)).toBe(false);
  });
});

describe('undoTargetOf', () => {
  const entry = (action: string, details: Record<string, unknown> | null = null) => ({ id: 9, action, entity_id: 4, details });
  it('should map each undoable entry to what it changed', () => {
    expect(undoTargetOf(entry('sale.recorded'))).toEqual({ kind: 'sale', id: 4 });
    expect(undoTargetOf(entry('return.approved'))).toEqual({ kind: 'return', id: 4 });
    expect(undoTargetOf(entry('write_off.requested'))).toEqual({ kind: 'write_off', id: 4 });
    expect(undoTargetOf(entry('count.line_approved', { productId: 7 }))).toEqual({ kind: 'count_line', id: 4, productId: 7 });
    expect(undoTargetOf(entry('stock.adjusted', { quantity: 3 }))).toEqual({ kind: 'stock', id: 9 });
    expect(undoTargetOf(entry('stock.adjusted', { reorderLevel: { from: 5, to: 8 } }))).toEqual({ kind: 'reorder_edit', id: 9 });
    expect(undoTargetOf(entry('product.updated'))).toEqual({ kind: 'product_edit', id: 9 });
    expect(undoTargetOf(entry('pricing.updated'))).toEqual({ kind: 'pricing_edit', id: 9 });
    expect(undoTargetOf(entry('settings.updated'))).toEqual({ kind: 'settings_edit', id: 9 });
    expect(undoTargetOf(entry('promotion.created'))).toEqual({ kind: 'promotion', id: 4 });
  });
  it('should give nothing for entries that cannot be undone', () => {
    for (const action of ['auth.logged_in', 'product.deleted', 'user.created', 'return.rejected', 'count.started', 'sale.undone']) {
      expect(undoTargetOf(entry(action))).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/undoRules.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.**

```ts
import type { UserRole } from '../../database/types.js';

export type UndoKind =
  | 'sale' | 'return' | 'write_off' | 'count_line' | 'stock'
  | 'product_edit' | 'pricing_edit' | 'settings_edit' | 'reorder_edit' | 'promotion';

interface Person { id: number; role: UserRole }

/**
 * The hierarchy: the developer may undo anyone; the owner and admins may undo
 * employees and themselves; nobody else may undo anything. `owner` is the person
 * whose action it was (null when they've been removed: developer only).
 */
export function canUndo(actor: Person, owner: Person | null): boolean {
  if (actor.role === 'developer') return true;
  if (actor.role !== 'admin' && actor.role !== 'owner') return false;
  if (owner === null) return false;
  return owner.id === actor.id || owner.role === 'employee';
}

/** What an activity entry changed, if it can be undone or reverted. */
export function undoTargetOf(entry: {
  id: number; action: string; entity_id: number | null; details: Record<string, unknown> | null;
}): { kind: UndoKind; id: number; productId?: number } | null {
  const entity = entry.entity_id;
  switch (entry.action) {
    case 'sale.recorded': return entity === null ? null : { kind: 'sale', id: entity };
    case 'return.requested':
    case 'return.approved': return entity === null ? null : { kind: 'return', id: entity };
    case 'write_off.requested':
    case 'write_off.approved': return entity === null ? null : { kind: 'write_off', id: entity };
    case 'count.line_approved': {
      const productId = Number(entry.details?.productId);
      return entity === null || !productId ? null : { kind: 'count_line', id: entity, productId };
    }
    case 'stock.adjusted':
      if (entry.details && 'reorderLevel' in entry.details) return { kind: 'reorder_edit', id: entry.id };
      return entry.details && 'quantity' in entry.details ? { kind: 'stock', id: entry.id } : null;
    case 'product.updated': return { kind: 'product_edit', id: entry.id };
    case 'pricing.updated': return { kind: 'pricing_edit', id: entry.id };
    case 'settings.updated': return { kind: 'settings_edit', id: entry.id };
    case 'promotion.created': return entity === null ? null : { kind: 'promotion', id: entity };
    default: return null;
  }
}
```
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: The rules for who may undo whose actions"`

### Task 3: Undo and restore sales, returns, write-offs, count corrections and stock changes

**Files:**
- Create: `backend/src/services/undo/UndoService.ts`
- Modify: `backend/src/constants/activity.ts` (actions `undo.applied`, `undo.restored`; entity type `activity`), `backend/src/constants/stock.ts` (`UNDO: 'Undo'`, `RESTORE: 'Restore'`), `backend/src/constants/notifications.ts` (`UNDONE: 'undone'`, push topic `decisions`), `backend/src/i18n/messages.ts` (en/sq `undoneTitle(what)`, `undoneMessage(note|null)`, `restoredTitle(what)`), `backend/src/container.ts` (wire `undoService`), `admin` and `mobile` stock-reason catalogues (`Undo`, `Restore`).
- Test: `backend/tests/undo.test.ts`

**Interfaces:**
- Consumes: `canUndo`, `undoTargetOf` (Task 2); `applyStockChange` (existing, `services/InventoryService.ts`); `TransactionManager.run`; `repos.notifications.createForUser(userId, { type, write })`.
- Produces: `UndoService.undo(entryId: number, actor: PublicUser, note: string | null): Promise<void>` and `UndoService.restore(entryId: number, actor: PublicUser): Promise<void>`. Both throw `NotFoundError` (no such entry or it can't be undone), `ForbiddenError` (hierarchy), `ConflictError` (already undone/restored, linked return, not enough stock, changed again since).

Behaviour per kind, each in **one transaction**, locking the target row with `FOR UPDATE` first:
- **sale:** refuse if a return on it is `pending`/`approved` and not undone ("Undo the return first"). Undo: `applyStockChange(+quantity, reason 'Undo', notes 'Undo of sale #<id>')`, set `undone_at/by/note`. Restore: `applyStockChange(-quantity, 'Restore')` (its "not enough stock" becomes `ConflictError('Only N left in stock')`), clear the columns. Owner = `sold_by`.
- **return:** only when `approved`. Undo: resellable → `applyStockChange(-quantity)`; damaged → mark its write-off (`write_offs.return_id = id`) undone too (no stock change: it never re-entered stock). Restore reverses it. Owner = `requested_by`.
- **write_off:** only when `approved` and `return_id IS NULL` (damaged-return write-offs follow their return). Undo `+quantity`, restore `-quantity`. Owner = `requested_by`.
- **count_line:** only when `approved`. Undo applies `-(counted - expected)`, restore `+(counted - expected)`. Owner = the count's `submitted_by`.
- **stock (manual):** the entry's `details.quantity`. Undo applies `-quantity`, restore `+quantity`. State lives on the `activity_log` row. Owner = the entry's `user_id`.

After each undo or restore: log `undo.applied` / `undo.restored` with `entityType: 'activity'`, `entityId: <original entry id>`, summary "Undid: <original summary>", details `{ entryId, kind, targetId, note, effect }`; then notify the owner (if not the actor) with type `undone`.

- [ ] **Step 1: Failing tests** in `tests/undo.test.ts`, calling the service directly (`context.container.undoService`) so this task stands alone before the endpoints exist. Cases:
  - employee sale → admin undoes with a note: stock back up, ledger revenue 0, entry `sale.undone_at` set, employee has an `undone` notification containing the note, activity has `undo.applied` with `entryId`.
  - restore that sale: stock down again, revenue back.
  - undo twice → `ConflictError` /already undone/; two concurrent undos (`Promise.allSettled`) → exactly one fulfilled.
  - sale with a pending return → `ConflictError` /return first/; with a **rejected** return → allowed.
  - restore after the product sold out → `ConflictError` /Only 0 left/ and nothing changed.
  - admin undoing the owner's sale → `ForbiddenError`; owner undoing an employee's write-off → allowed; employee undoing anything → `ForbiddenError`.
  - approved damaged return → undo marks return and its write-off undone, stock unchanged; restore clears both.
  - count line correction → undo reverses the stock difference.
  - manual stock change +5 → undo −5; restore +5.

```ts
it('should undo an employee sale: stock back, money gone, the employee told why', async () => {
  const productId = await createTestProduct(context, adminToken, { price: 50, stock: 10 });
  const sale = await request(context.app).post('/api/sales').set(auth(employeeToken)).send({ productId, quantity: 3 });
  const entry = await context.db.selectFrom('activity_log').select('id').where('action', '=', 'sale.recorded').executeTakeFirstOrThrow();

  await context.container.undoService.undo(entry.id, admin, 'typed 3 instead of 2');

  expect(await stockOf(context, productId)).toBe(10);
  const row = await context.db.selectFrom('sales').select(['undone_at', 'undo_note']).where('id', '=', sale.body.data.id).executeTakeFirstOrThrow();
  expect(row.undo_note).toBe('typed 3 instead of 2');
  const alert = await context.db.selectFrom('notifications').select(['type', 'message']).where('user_id', '=', employee.id).where('type', '=', 'undone').executeTakeFirstOrThrow();
  expect(alert.message).toContain('typed 3 instead of 2');
});
```
(`admin` and `employee` are `PublicUser`s created in `beforeEach` with `createTestUser` + `toPublicUser`.)

- [ ] **Step 2: Run** `npx vitest run tests/undo.test.ts`. Expected: FAIL (`undoService` undefined).
- [ ] **Step 3: Implement** `UndoService` with the behaviour above: one private method per kind (`sale`, `return`, `writeOff`, `countLine`, `stock`) taking `(repos, target, actor, mode: 'undo' | 'restore', note)` and returning `{ owner, what, effect }`. Then `undo()` and `restore()` share the logging and notification tail. Row locking: `sql\`SELECT ... FOR UPDATE\`` through `repos` or a raw `trx` query, following `ReturnRepository.lock`. Map `ValidationError` from `applyStockChange` to `ConflictError(t.onlyLeft)`.
- [ ] **Step 4: Run** the test file, then `npm test`. Expected: all PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: Undo and restore sales, returns, damage reports, count corrections and stock changes"`

### Task 4: Revert and restore edits

**Files:**
- Create: `backend/src/services/undo/editReverts.ts`
- Modify: `backend/src/services/ProductService.ts` (`update(id, input, actorId, logExtra?: Record<string, unknown>)` merges `logExtra` into the logged `details`), the same optional `logExtra` on `PricingService.replaceTiers`, `SettingsService.update`, `InventoryService.adjust` (reorder level) and `PromotionService.end`; `UndoService` delegates the edit kinds here.
- Test: `backend/tests/undoEdits.test.ts`

**Interfaces:**
- Consumes: Task 2 kinds; `ProductService`, `PricingService`, `SettingsService`, `InventoryService`, `PromotionService`.
- Produces: `revertEdit(entry, actor, mode)` used by `UndoService` for `product_edit`, `pricing_edit`, `settings_edit`, `reorder_edit` and `promotion`.

Rules:
- **Latest change only:** a revert is refused when a later, not-undone activity entry for the same entity (`entity_type`, `entity_id`; `settings` uses the keys) changed any of the same fields **and** is not itself this entry's own revert (`details.revertOf !== entry.id`). Message: "Changed again since · revert the newer change first".
- **Apply:** product → current product as `ProductInput`, overlay `from` values of the fields in `details`, call `productService.update(id, input, actor.id, { revertOf: entry.id })`. Pricing → `replaceTiers(productId, details.from, …)`. Settings → `settingsService.update({ key: from … })`. Reorder → `inventoryService.adjust(productId, { reorderLevel: from })`. Promotion → `promotionService.end(id)` (restore is refused: "Start a new promotion instead").
- **Restore** applies the `to` values the same way, with the same "changed again since" check against entries after the revert.
- Product deleted since → `ConflictError('This product was deleted, so its edit can't be reverted')`.
- State lives on the `activity_log` row of the edit.

- [ ] **Step 1: Failing tests:**
  - price €89 → €79 by admin; developer reverts → price €89, entry marked undone, a `product.updated` entry with `details.revertOf`.
  - restore → €79.
  - edits €89 → €79 (A) then €79 → €85 (B); reverting A → `ConflictError` /changed again since/; reverting B → OK.
  - bulk prices revert; settings revert (refund limit 50 → 80 → back to 50); reorder level revert.
  - promotion revert ends it; restore refused.
  - product deleted after the edit → `ConflictError` /deleted/.
- [ ] **Step 2: Run** `npx vitest run tests/undoEdits.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `editReverts.ts` and the `logExtra` parameters (`details: { ...change.details, ...logExtra }`).
- [ ] **Step 4: Run** the file and `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: Revert and restore product, price and settings edits"`

### Task 5: Endpoints, and undo state on every activity entry

**Files:**
- Modify: `backend/src/routes/activityRoutes.ts`, `backend/src/controllers/activityController.ts`, `backend/src/validators/activityValidators.ts`, `backend/src/services/ActivityLogService.ts`, `backend/src/repositories/ActivityLogRepository.ts`, `docs/API.md`
- Test: `backend/tests/undoApi.test.ts`

**Interfaces:**
- Produces (HTTP, overseers only via `guards.oversee`):
  - `POST /api/activity/:id/undo` body `{ note?: string (≤500) }` → `200 { data: ActivityEntryDto }` (the original entry, now undone)
  - `POST /api/activity/:id/restore` → `200 { data: ActivityEntryDto }`
  - `GET /api/activity` entries gain:
    ```ts
    undo: null | {
      state: 'undoable' | 'undone' | 'locked' | 'forbidden';
      kind: UndoKind;
      undoneBy: { id: number; name: string } | null;
      undoneAt: string | null;
      note: string | null;
      /** Plain facts for the confirmation; the dashboard words them in its language. */
      effect: { stock?: { product: string; delta: number }; money?: { amount: number; day: string }; fields?: Array<{ field: string; from: unknown; to: unknown }> };
      /** Why it can't be undone right now, e.g. 'linked_return' | 'changed_since' | 'deleted' | 'not_approved'. */
      lockedReason: string | null;
    }
    ```
  `state` is computed for the requesting user: `forbidden` when `canUndo` says no (the dashboard hides the button), `locked` with `lockedReason` otherwise blocked.

- [ ] **Step 1: Failing tests:**
  - `POST /undo` with a note → 200, `undo.state === 'undone'`, `undo.note` set; repeating → 409.
  - employee token → 403; unknown id → 404; a sign-in entry → 404 "can't be undone".
  - `GET /api/activity?userId=<employee>` → a sale entry has `undo.state 'undoable'` and `effect.stock.delta === quantity`, `effect.money.amount` = the sale total.
  - for an admin viewing the owner's entries → `undo.state === 'forbidden'`.
  - `POST /restore` → `state 'undoable'` again.
- [ ] **Step 2: Run** `npx vitest run tests/undoApi.test.ts`. Expected: FAIL (404 on the route).
- [ ] **Step 3: Implement** the routes and controller (`parseInput(undoBodySchema, req.body)` with `z.object({ note: z.string().trim().max(500).optional() })`). `ActivityLogService.list(query, viewer)` fetches the page, then **batches** the state lookups per kind (one query per kind for the ids on the page), and maps them with `canUndo(viewer, owner)`.
- [ ] **Step 4: Run** the file and `npm test`. Expected: PASS. Update `docs/API.md` (Activity section).
- [ ] **Step 5: Commit:** `git commit -m "feat: Undo and restore from the activity log over the API"`

### Task 6: Dashboard: the person's activity page with Undo and Restore

**Files:**
- Create: `admin/src/components/activity/activityText.ts` (+ `activityText.test.ts`), `admin/src/components/activity/ActivityTimeline.tsx`, `admin/src/components/activity/UndoConfirm.tsx`, `admin/src/pages/PersonActivityPage.tsx`, `admin/src/styles/activity.css` (imported from `index.css`)
- Modify: `admin/src/App.tsx` (route `people/:id`), `admin/src/pages/UsersPage.tsx` (an "Activity" link per person), `admin/src/pages/ActivityPage.tsx` (uses `ActivityTimeline`), `admin/src/services/api.ts` + `types.ts` (`activityApi.undo(id, note)`, `activityApi.restore(id)`, `ActivityEntry.undo`), `admin/src/i18n/en.ts` + `sq.ts` (`undo` section), `admin/src/i18n/hardcodedText.test.ts` (new files on the list)

**Interfaces:**
- Consumes: Task 5 API.
- Produces: `<ActivityTimeline entries onChanged />`, `<UndoConfirm entry onDone onCancel />`, `effectSentence(t, effect): string[]`.

Design (spec "Where it lives and how it looks"; DESIGN.md tokens only):
- Page header: crumbs People › name, avatar, role badge, summary strip (today's sales total and count from `reportsApi.team` for today, filtered to this person; number of undone entries on the page).
- Filters: kind select (Everything, Sales, Stock, Damage, Returns, Counts, Edits → action prefixes) and period select (Today, 7 days, 30 days → `startDate`), stored in the URL (`?kind=&period=`).
- Timeline: day headers (Today, Yesterday, then `formatDateWith(..., { weekday: 'long', day: 'numeric', month: 'long' })`). Rows show a coloured marker (CSS variable per kind), the time (`formatDateTime` in a `title` attribute for the full date), the summary, the amount, and on the right **Undo** / **Restore** (`Button size="sm"`, only when `state` is `undoable`/`undone`) or a muted lock reason.
- Undone rows: summary struck through (`text-decoration: line-through`, `color: var(--steel)`), a stamp "Undone by <name> · <time>", the note in quotes.
- `UndoConfirm` opens **inline under the row** (not a modal): heading "Undo this sale?", the effect lines from `effectSentence` (e.g. "+2 Oak Chair back in stock", "−€178.00 from Saturday, 3 October", "Price goes back from €79.00 to €89.00"), an optional reason field (max 500), buttons **Undo sale** (primary, danger tone) and **Cancel**. Restore shows the same panel with "Restore this sale?". Busy state disables both buttons; a server refusal shows inline in `form-error`. Focus moves to the panel heading on open and back to the row's button on close; Esc cancels.
- After success: invalidate `['activity']`, `['reports']`, `['inventory']`, `['products']`, `['sales']`.

- [ ] **Step 1: Failing tests** in `activityText.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import { effectSentence } from './activityText';

describe('effectSentence', () => {
  it('should say what an undo puts back', () => {
    expect(effectSentence(en, { stock: { product: 'Oak Chair', delta: 2 }, money: { amount: -178, day: '2026-10-03T10:00:00Z' } })).toEqual([
      '+2 Oak Chair back in stock',
      '−€178.00 from Saturday, 3 October',
    ]);
  });
  it('should say what an edit goes back to', () => {
    expect(effectSentence(en, { fields: [{ field: 'price', from: 79, to: 89 }] })).toEqual(['Price goes back from €79.00 to €89.00']);
  });
});
```
Add the four new `.tsx` files to `TRANSLATED` in `hardcodedText.test.ts`.
- [ ] **Step 2: Run** `cd admin && npx vitest run`. Expected: FAIL (module missing, guard can't find files).
- [ ] **Step 3: Implement** the files above with the existing kit (`Card`, `PageHeader`, `Button`, `Badge`, `EmptyState`, `Loading`, `ErrorNotice`) and en/sq texts. Albanian for the key terms: Undo = "Zhbëj", Restore = "Rikthe", Undone by = "Zhbërë nga", Reason (optional) = "Arsyeja (opsionale)".
- [ ] **Step 4: Run** `npx vitest run && npm run lint && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: Each person's activity in the dashboard, with undo and restore"`

### Task 7: Team app: undone entries under "Your requests"

**Files:**
- Modify: `backend/src/repositories/ApprovalRepository.ts` (`requestsBy` adds `sale` rows that are undone, and selects `undone_at`/`undo_note` for write-offs and returns), `backend/src/services/ApprovalService.ts` (`MyRequestDto.type` gains `'sale'`; `status: 'undone'` when undone; `decisionNote` carries the undo note), `mobile/src/screens/HomeScreen.tsx` (`requestStatus.undone`), `mobile/src/i18n/en.ts` + `sq.ts`
- Test: `backend/tests/undo.test.ts` (add one case)

- [ ] **Step 1: Failing test:** after undoing an employee's sale with a note, `GET /api/approvals/mine` as that employee contains `{ type: 'sale', status: 'undone', decisionNote: '<note>' }`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the union branch:

```sql
union all
select 'sale', s.id, p.name, s.quantity_sold, s.total_amount, null, null, 'undone', s.undo_note, s.sale_date, s.undone_at
from sales s join products p on p.id = s.product_id
where s.sold_by = ${userId} and s.undone_at is not null and s.undone_at >= ${since}
```
and status `undone` overrides for undone returns/write-offs. Team app: `requestStatus.undone = 'Undone by the owner'` / `'U zhbë nga pronari'`, shown with the note like a rejection.
- [ ] **Step 4: Run** backend tests and `cd mobile && npx vitest run && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: Employees see their undone sales and reports, with the reason"`

### Task 8: Check it, review it, merge it

- [ ] **Step 1: Visual pass** (CLAUDE.md: once for the finished feature). Run backend + dashboard, seed demo data locally, open a person's activity, undo and restore a sale, a write-off, a price edit, in English and Shqip, at 375px and 1440px. Fix overflow or clipping.
- [ ] **Step 2: Audits:** run the `web-design-guidelines` and `fixing-accessibility` skills on the new components and fix findings (focus management of the inline confirm, labels, contrast of the struck-through text).
- [ ] **Step 3: Verify** with `superpowers:verification-before-completion`: backend `npm test`, admin `npx vitest run && npm run lint && npm run build`, mobile `npx vitest run && npx tsc --noEmit`.
- [ ] **Step 4: Review and merge** with `superpowers:requesting-code-review` (whole branch, Review Focus above), fix Critical/Important with a failing test first, then `superpowers:finishing-a-development-branch`: merge into `main`, push, delete the branch.
