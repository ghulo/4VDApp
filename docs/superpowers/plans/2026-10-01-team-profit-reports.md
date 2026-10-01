# Team & Profit Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accurate historical profit, period/team/profit reports, reorder suggestions, CSV exports, an activity log, and a "My sales" view for employees.

**Architecture:** One new migration adds `sales.unit_cost` and an `activity_log` table. A new `ReportsRepository`/`ReportsService` pair holds all report SQL and maths, with pure calculation helpers unit-tested on their own. Existing services write activity entries inside their existing transactions, which are extended so every logged change is atomic. The admin dashboard gets Reports and Activity pages and runway columns on Stock, and the mobile Account tab gets "My sales".

**Tech Stack:** Node 22, Express 5, TypeScript, Kysely + pg (PostgreSQL 17), zod 4, Vitest + Supertest; React 19 + Vite + TanStack Query (admin); Expo SDK 57 + React Navigation (mobile).

**Spec:** `docs/superpowers/specs/2026-10-01-team-profit-reports-design.md`

## Global Constraints

- Profit = revenue − cost **at the time of the sale** (`sales.unit_cost`); sales with `unit_cost IS NULL` are excluded from cost, profit and margin, and their revenue is reported as `revenueWithoutCost`.
- Comparison period = the same length of time immediately before the selected period.
- Report endpoints take `startDate` and `endDate` (ISO; end exclusive; a date-only `endDate` includes that whole day) and the range can be at most 366 days.
- Employees only ever see their own `salesCount`, `unitsSold` and `revenue`: never cost, profit or other people.
- Activity actions: `auth.logged_in`, `product.created`, `product.updated`, `product.deleted`, `pricing.updated`, `stock.adjusted`, `sale.recorded`, `category.created`, `category.updated`, `category.deleted`, `user.created`, `user.updated`, `user.deleted`.
- A failure writing the activity log rolls the change back (except `auth.logged_in`, which is an event, not a change).
- CSV: UTF-8 with BOM, comma separated, CRLF line ends; string cells starting with `=`, `+`, `-`, `@`, tab or carriage return get a leading `'`.
- All responses except CSV downloads use the existing JSON envelope (`sendSuccess`/`sendError`).
- Commit messages: plain, human English with a `feat:`/`fix:`/`docs:` prefix and a short body explaining the change (user preference), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A product name containing commas, quotes or line breaks must come out of a CSV export as one correctly quoted cell, not shifted columns. Test in Task 7.
- Sales by a team member who has since been removed must still appear in the team report under their name. Test in Task 6.
- Sales of a product that was later hidden or deleted must still count in profit and team reports. Test in Task 6.
- A date-only `endDate` (`2026-03-31`) must include sales made late on that day. Test in Task 6.
- A user's password must never appear in the activity log, even when an admin sets a new one. Test in Task 4.

---

### Task 1: Save the cost on every sale and use it for profit

**Files:**
- Create: `backend/src/database/migrations/002_reports_and_activity.ts`
- Modify: `backend/src/database/migrations/index.ts`
- Modify: `backend/src/database/types.ts`
- Modify: `backend/src/repositories/SalesRepository.ts` (`create`, `totals`)
- Modify: `backend/src/services/SalesService.ts` (`record`)
- Modify: `backend/tests/helpers/testApp.ts` (`resetData`)
- Test: `backend/tests/reports.test.ts` (new file, first `describe`)

**Interfaces:**
- Produces: column `sales.unit_cost` (`Decimal | null` in `SalesTable`); table `activity_log` with `ActivityLogTable` type; `SalesRepository.create({ ..., unitCost: number | null })`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/reports.test.ts`:

```ts
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestCategory, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let categoryId: number;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
  categoryId = (await createTestCategory(context.db)).id;
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createProduct(overrides: Record<string, unknown> = {}): Promise<number> {
  const response = await request(context.app)
    .post('/api/products')
    .set(auth(adminToken))
    .send({ name: 'Oak Chair', categoryId, price: 100, costPrice: 60, stock: 100, reorderLevel: 10, ...overrides });
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  return response.body.data.id as number;
}

async function sell(token: string, productId: number, quantity: number, saleDate?: string) {
  const response = await request(context.app).post('/api/sales').set(auth(token)).send({ productId, quantity, saleDate });
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  return response.body.data;
}

describe('cost at time of sale', () => {
  it('should keep the original profit when the cost price changes later', async () => {
    const productId = await createProduct();
    await sell(adminToken, productId, 2);

    await request(context.app)
      .put(`/api/products/${productId}`)
      .set(auth(adminToken))
      .send({ name: 'Oak Chair', categoryId, price: 100, costPrice: 90 });
    const dashboard = await request(context.app).get('/api/analytics/dashboard').set(auth(adminToken));
    const sale = await context.db.selectFrom('sales').select('unit_cost').executeTakeFirstOrThrow();

    expect(sale.unit_cost).toBe('60.00');
    expect(dashboard.body.data.totalProfit).toBe(80);
  });

  it('should save no cost when the product has no cost price', async () => {
    const productId = await createProduct({ costPrice: null });
    await sell(adminToken, productId, 1);

    const sale = await context.db.selectFrom('sales').select('unit_cost').executeTakeFirstOrThrow();

    expect(sale.unit_cost).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/reports.test.ts`
Expected: FAIL, because column `unit_cost` does not exist (TypeScript or SQL error).

- [ ] **Step 3: Write the migration**

Create `backend/src/database/migrations/002_reports_and_activity.ts`:

```ts
import { type Kysely, sql } from 'kysely';

/**
 * - sales.unit_cost: the product's cost when it was sold, so profit doesn't
 *   change when a cost price is edited later. Existing sales are filled from
 *   today's cost, which is the best information available for them.
 * - activity_log: who changed what, for the admin's Activity page.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE sales ADD COLUMN unit_cost DECIMAL(10, 2) CHECK (unit_cost >= 0)`.execute(db);
  await sql`UPDATE sales s SET unit_cost = p.cost_price FROM products p WHERE p.id = s.product_id`.execute(db);

  await sql`CREATE TABLE activity_log (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(30),
    entity_id INT,
    summary TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`.execute(db);
  await sql`CREATE INDEX idx_activity_log_created ON activity_log (created_at DESC)`.execute(db);
  await sql`CREATE INDEX idx_activity_log_user ON activity_log (user_id)`.execute(db);
  await sql`CREATE INDEX idx_activity_log_entity ON activity_log (entity_type, entity_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS activity_log`.execute(db);
  await sql`ALTER TABLE sales DROP COLUMN IF EXISTS unit_cost`.execute(db);
}
```

Register it in `backend/src/database/migrations/index.ts`:

```ts
import type { Migration } from 'kysely/migration';
import * as initialSchema from './001_initial_schema.js';
import * as reportsAndActivity from './002_reports_and_activity.js';

/**
 * Every migration, keyed by name. Kysely runs them in key order, so always
 * prefix new ones with the next number. Listing them here (instead of reading
 * the folder at runtime) works the same under tsx, the compiled build and
 * Windows paths.
 */
export const migrations: Record<string, Migration> = {
  '001_initial_schema': initialSchema,
  '002_reports_and_activity': reportsAndActivity,
};
```

- [ ] **Step 4: Update the table types**

In `backend/src/database/types.ts`, add `unit_cost` to `SalesTable` right after `price_per_unit`:

```ts
  /** Product cost when sold; null when it was unknown. */
  unit_cost: Decimal | null;
```

Add the activity log table type after `FavoritesTable`:

```ts
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
```

Add `activity_log: ActivityLogTable;` to the `Database` interface, and `export type ActivityLogRow = Selectable<ActivityLogTable>;` at the bottom.

- [ ] **Step 5: Save the cost when recording a sale**

In `backend/src/repositories/SalesRepository.ts`, replace `create` with:

```ts
  async create(sale: {
    productId: number;
    quantity: number;
    pricePerUnit: number;
    unitCost: number | null;
    soldBy: number;
    notes: string | null;
    saleDate?: Date;
  }): Promise<number> {
    const row = await this.db
      .insertInto('sales')
      .values({
        product_id: sale.productId,
        quantity_sold: sale.quantity,
        price_per_unit: sale.pricePerUnit,
        unit_cost: sale.unitCost,
        sold_by: sale.soldBy,
        notes: sale.notes,
        ...(sale.saleDate && { sale_date: sale.saleDate }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }
```

In the same file's `totals`, replace the profit expression so it uses the saved cost:

```ts
        // Profit only counts sales whose cost was known when they were made.
        sql<string>`coalesce(sum(s.quantity_sold * (s.price_per_unit - s.unit_cost)) filter (where s.unit_cost is not null), 0)`.as(
          'profit',
        ),
```

In `backend/src/services/SalesService.ts`, inside `record`, change the `repos.sales.create` call to:

```ts
      const id = await repos.sales.create({
        productId: product.id,
        quantity: input.quantity,
        pricePerUnit,
        unitCost: toMoneyOrNull(product.cost_price),
        soldBy,
        notes: input.notes,
        saleDate: input.saleDate,
      });
```

and change the mappers import to `import { toMoney, toMoneyOrNull } from './mappers.js';`.

- [ ] **Step 6: Include the new table in test resets**

In `backend/tests/helpers/testApp.ts`, replace the `TRUNCATE` statement in `resetData` with:

```ts
  await sql`TRUNCATE users, refresh_tokens, categories, products, inventory, bulk_pricing_tiers,
    sales, stock_adjustments, product_images, notifications, favorites, activity_log RESTART IDENTITY CASCADE`.execute(db);
```

- [ ] **Step 7: Run all backend tests**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: all tests pass, including the 2 new ones.

- [ ] **Step 8: Migrate the local database and check it rolls back cleanly**

Run: `cd backend && npm run migrate && npm run migrate:down && npm run migrate`
Expected: three "Migration finished" lines for `002_reports_and_activity` (Up, Down, Up), each `"status":"Success"`.

- [ ] **Step 9: Commit**

```bash
git add backend
git commit -m "feat: Remember the cost of each sale so profit stays correct" -m "Profit used today's cost price, so editing a cost rewrote past profit. Each sale now saves the product's cost at the moment it's sold, and existing sales were filled in from the current cost. Also creates the table the activity log will use." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Activity log storage and the Activity endpoint

**Files:**
- Create: `backend/src/constants/activity.ts`
- Create: `backend/src/repositories/ActivityLogRepository.ts`
- Create: `backend/src/services/ActivityLogService.ts`
- Create: `backend/src/validators/activityValidators.ts`
- Create: `backend/src/controllers/activityController.ts`
- Create: `backend/src/routes/activityRoutes.ts`
- Modify: `backend/src/repositories/TransactionManager.ts`
- Modify: `backend/src/container.ts`
- Modify: `backend/src/routes/index.ts`
- Test: `backend/tests/activity.test.ts` (new)

**Interfaces:**
- Produces: `type ActivityAction` (union of the 13 actions); `interface NewActivity { userId: number | null; action: ActivityAction; entityType: ActivityEntityType | null; entityId: number | null; summary: string; details?: Record<string, unknown> | null }`; `ActivityLogRepository.create(entry: NewActivity): Promise<void>`; `ActivityLogRepository.findMany(filters)`; `repos.activityLog`, `repos.categories` and `repos.users` inside `TransactionManager.run`; `GET /api/activity` (admin).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/activity.test.ts`:

```ts
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityLogRepository } from '../src/repositories/ActivityLogRepository.js';
import { createTestUser, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const listActivity = (query = '') => request(context.app).get(`/api/activity${query}`).set(auth(adminToken));

describe('GET /api/activity', () => {
  it('should list entries newest first with who did them', async () => {
    const employee = await createTestUser(context.db, 'employee');
    const repository = new ActivityLogRepository(context.db);
    await repository.create({ userId: employee.id, action: 'product.created', entityType: 'product', entityId: 1, summary: 'Added product Chair' });
    await repository.create({ userId: employee.id, action: 'product.deleted', entityType: 'product', entityId: 1, summary: 'Deleted product Chair' });

    const response = await listActivity('?entityType=product');

    expect(response.status).toBe(200);
    expect(response.body.data.map((entry: { summary: string }) => entry.summary)).toEqual([
      'Deleted product Chair',
      'Added product Chair',
    ]);
    expect(response.body.data[0].user).toEqual({ id: employee.id, name: 'Test employee' });
    expect(response.body.meta.total).toBe(2);
  });

  it('should filter by action prefix, exact action, person and entity', async () => {
    const employee = await createTestUser(context.db, 'employee');
    const repository = new ActivityLogRepository(context.db);
    await repository.create({ userId: employee.id, action: 'stock.adjusted', entityType: 'product', entityId: 7, summary: 'Added 5 to Lamp (Restock)' });
    await repository.create({ userId: null, action: 'category.created', entityType: 'category', entityId: 2, summary: 'Added category Lighting' });
    await repository.create({ userId: employee.id, action: 'pricing.updated', entityType: 'product', entityId: 8, summary: 'Updated bulk prices for Rug' });

    const byPrefixes = await listActivity('?action=category,pricing');
    const byExact = await listActivity('?action=stock.adjusted');
    const byPerson = await listActivity(`?userId=${employee.id}`);
    const byEntity = await listActivity('?entityType=product&entityId=7');

    expect(byPrefixes.body.data).toHaveLength(2);
    expect(byExact.body.data.map((entry: { action: string }) => entry.action)).toEqual(['stock.adjusted']);
    expect(byPerson.body.data).toHaveLength(2);
    expect(byEntity.body.data).toHaveLength(1);
  });

  it('should be admin only', async () => {
    const employeeToken = await loginAs(context, 'employee');

    const response = await request(context.app).get('/api/activity').set(auth(employeeToken));

    expect(response.status).toBe(403);
  });

  it('should reject a malformed action filter', async () => {
    const response = await listActivity('?action=DROP%20TABLE');

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/activity.test.ts`
Expected: FAIL with "Cannot find module '../src/repositories/ActivityLogRepository.js'".

- [ ] **Step 3: Add the action names**

Create `backend/src/constants/activity.ts`:

```ts
export const ACTIVITY_ACTIONS = [
  'auth.logged_in',
  'product.created',
  'product.updated',
  'product.deleted',
  'pricing.updated',
  'stock.adjusted',
  'sale.recorded',
  'category.created',
  'category.updated',
  'category.deleted',
  'user.created',
  'user.updated',
  'user.deleted',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export const ACTIVITY_ENTITY_TYPES = ['product', 'category', 'user', 'sale'] as const;
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];
```

- [ ] **Step 4: Write the repository**

Create `backend/src/repositories/ActivityLogRepository.ts`:

```ts
import type { ActivityAction, ActivityEntityType } from '../constants/activity.js';
import type { DatabaseClient } from '../database/connection.js';

export interface NewActivity {
  userId: number | null;
  action: ActivityAction;
  entityType: ActivityEntityType | null;
  entityId: number | null;
  /** A sentence a person can read, e.g. "Changed price of Oak Chair from €89.00 to €95.00". */
  summary: string;
  details?: Record<string, unknown> | null;
}

export interface ActivityFilters {
  userId?: number;
  entityType?: ActivityEntityType;
  entityId?: number;
  /** Each item is an exact action ("stock.adjusted") or a prefix ("stock"). */
  actions?: string[];
  limit: number;
  offset: number;
}

export interface ActivityRecord {
  id: number;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  summary: string;
  details: Record<string, unknown> | null;
  created_at: Date;
  user_id: number | null;
  user_name: string | null;
}

export class ActivityLogRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(entry: NewActivity): Promise<void> {
    await this.db
      .insertInto('activity_log')
      .values({
        user_id: entry.userId,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        summary: entry.summary,
        details: entry.details ?? null,
      })
      .execute();
  }

  async findMany(filters: ActivityFilters): Promise<{ entries: ActivityRecord[]; total: number }> {
    let query = this.db.selectFrom('activity_log as a').leftJoin('users as u', 'u.id', 'a.user_id');
    if (filters.userId) query = query.where('a.user_id', '=', filters.userId);
    if (filters.entityType) query = query.where('a.entity_type', '=', filters.entityType);
    if (filters.entityId) query = query.where('a.entity_id', '=', filters.entityId);
    if (filters.actions && filters.actions.length > 0) {
      const actions = filters.actions;
      query = query.where((eb) =>
        eb.or(actions.map((action) => (action.includes('.') ? eb('a.action', '=', action) : eb('a.action', 'like', `${action}.%`)))),
      );
    }

    const [entries, count] = await Promise.all([
      query
        .select([
          'a.id',
          'a.action',
          'a.entity_type',
          'a.entity_id',
          'a.summary',
          'a.details',
          'a.created_at',
          'a.user_id',
          'u.name as user_name',
        ])
        .orderBy('a.created_at', 'desc')
        .orderBy('a.id', 'desc')
        .limit(filters.limit)
        .offset(filters.offset)
        .execute(),
      query.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
    ]);
    return { entries, total: Number(count.total) };
  }
}
```

- [ ] **Step 5: Make the log, categories and users available inside transactions**

Replace `createTransactionalRepositories` in `backend/src/repositories/TransactionManager.ts` (add the three imports at the top: `ActivityLogRepository`, `CategoryRepository`, `UserRepository`):

```ts
function createTransactionalRepositories(db: DatabaseClient) {
  return {
    products: new ProductRepository(db),
    pricingTiers: new PricingTierRepository(db),
    inventory: new InventoryRepository(db),
    stockAdjustments: new StockAdjustmentRepository(db),
    notifications: new NotificationRepository(db),
    sales: new SalesRepository(db),
    activityLog: new ActivityLogRepository(db),
    categories: new CategoryRepository(db),
    users: new UserRepository(db),
  };
}
```

- [ ] **Step 6: Write the service, validator, controller and route**

Create `backend/src/services/ActivityLogService.ts`:

```ts
import type { ActivityFilters, ActivityLogRepository } from '../repositories/ActivityLogRepository.js';
import { type PageRequest, toOffset, toPaginationMeta } from '../utils/pagination.js';

export interface ActivityQuery extends PageRequest, Omit<ActivityFilters, 'limit' | 'offset'> {}

export class ActivityLogService {
  constructor(private readonly activityLogRepository: ActivityLogRepository) {}

  async list(query: ActivityQuery) {
    const { entries, total } = await this.activityLogRepository.findMany({
      userId: query.userId,
      entityType: query.entityType,
      entityId: query.entityId,
      actions: query.actions,
      limit: query.limit,
      offset: toOffset(query),
    });
    return {
      items: entries.map((entry) => ({
        id: entry.id,
        action: entry.action,
        entityType: entry.entity_type,
        entityId: entry.entity_id,
        summary: entry.summary,
        details: entry.details,
        createdAt: entry.created_at.toISOString(),
        user: entry.user_id === null ? null : { id: entry.user_id, name: entry.user_name ?? 'Removed user' },
      })),
      meta: toPaginationMeta(query, total),
    };
  }
}
```

Create `backend/src/validators/activityValidators.ts`:

```ts
import { z } from 'zod';
import { ACTIVITY_ENTITY_TYPES } from '../constants/activity.js';
import { idSchema, paginationSchema } from './validate.js';

export const activityQuerySchema = paginationSchema.extend({
  userId: idSchema.optional(),
  entityType: z.enum(ACTIVITY_ENTITY_TYPES).optional(),
  entityId: idSchema.optional(),
  // Comma-separated exact actions or prefixes: "stock" or "product,pricing,category".
  action: z
    .string()
    .regex(/^[a-z_]+(\.[a-z_]+)?(,[a-z_]+(\.[a-z_]+)?)*$/, 'use action names like stock or stock.adjusted, separated by commas')
    .max(200)
    .transform((value) => value.split(','))
    .optional(),
});
```

Create `backend/src/controllers/activityController.ts`:

```ts
import type { Request, Response } from 'express';
import type { ActivityLogService } from '../services/ActivityLogService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { activityQuerySchema } from '../validators/activityValidators.js';
import { parseInput } from '../validators/validate.js';

export function createActivityController(activityLogService: ActivityLogService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const { action, ...query } = parseInput(activityQuerySchema, req.query);
      const { items, meta } = await activityLogService.list({ ...query, actions: action });
      sendSuccess(res, items, { meta });
    },
  };
}
```

Create `backend/src/routes/activityRoutes.ts`:

```ts
import { Router } from 'express';
import type { Container } from '../container.js';
import { createActivityController } from '../controllers/activityController.js';

export function createActivityRoutes({ activityLogService, guards }: Container): Router {
  const controller = createActivityController(activityLogService);
  const router = Router();

  router.get('/', ...guards.admin, controller.list);

  return router;
}
```

- [ ] **Step 7: Wire it up**

In `backend/src/container.ts`: import `ActivityLogRepository` and `ActivityLogService`, create them next to the other repositories and services, and add `activityLogRepository` and `activityLogService` to the returned object:

```ts
  const activityLogRepository = new ActivityLogRepository(db);
  // ...
  const activityLogService = new ActivityLogService(activityLogRepository);
```

In `backend/src/routes/index.ts`: import `createActivityRoutes` from `./activityRoutes.js` and add `router.use('/activity', createActivityRoutes(container));` after the favorites line.

- [ ] **Step 8: Run tests**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: all pass, including the 4 new activity tests.

- [ ] **Step 9: Commit**

```bash
git add backend
git commit -m "feat: Add the activity log and an endpoint to read it" -m "Admins can list who did what (GET /api/activity), newest first, filtered by person, by kind of change or by a specific product. Nothing writes to the log yet; the next commits hook up each kind of change." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Log product, price and category changes

**Files:**
- Create: `backend/src/utils/money.ts`
- Create: `backend/src/services/activity/describeProductChanges.ts`
- Modify: `backend/src/services/ProductService.ts` (`create`, `update`, `delete`)
- Modify: `backend/src/services/PricingService.ts` (`replaceTiers`)
- Modify: `backend/src/services/CategoryService.ts` (all writes)
- Modify: `backend/src/controllers/productController.ts`, `pricingController.ts`, `categoryController.ts`
- Modify: `backend/src/container.ts` (`CategoryService` gets `transactions`)
- Test: `backend/tests/describeProductChanges.test.ts` (new), `backend/tests/activity.test.ts` (append)

**Interfaces:**
- Consumes: `repos.activityLog.create(entry: NewActivity)`, `repos.categories` (Task 2).
- Produces: `formatEuro(amount: number): string`; `describeProductChanges(before: ProductSnapshot, after: ProductSnapshot): { summary: string; details: Record<string, { from: unknown; to: unknown }> } | null`; new signatures `ProductService.update(id, input, actorId)`, `ProductService.delete(id, actorId)`, `PricingService.replaceTiers(productId, tiers, actorId)`, `CategoryService.create(input, actorId)`, `CategoryService.update(id, input, actorId)`, `CategoryService.delete(id, actorId)`.

- [ ] **Step 1: Write the failing unit test**

Create `backend/tests/describeProductChanges.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { describeProductChanges, type ProductSnapshot } from '../src/services/activity/describeProductChanges.js';

const base: ProductSnapshot = {
  name: 'Oak Chair',
  description: null,
  categoryId: 1,
  price: 89,
  costPrice: 45,
  imageUrl: null,
  sku: 'CHAIR-1',
  isActive: true,
  bulkPricingTiers: [{ quantity: 10, price: 80 }],
};

describe('describeProductChanges', () => {
  it('should lead with a price change and list the other fields', () => {
    const result = describeProductChanges(base, { ...base, price: 95, sku: 'CHAIR-2' });

    expect(result?.summary).toBe('Changed price of Oak Chair from €89.00 to €95.00 (also changed SKU)');
    expect(result?.details).toEqual({ price: { from: 89, to: 95 }, sku: { from: 'CHAIR-1', to: 'CHAIR-2' } });
  });

  it('should describe hiding a product', () => {
    expect(describeProductChanges(base, { ...base, isActive: false })?.summary).toBe('Hid Oak Chair from the app');
  });

  it('should describe a rename using both names', () => {
    expect(describeProductChanges(base, { ...base, name: 'Oak Dining Chair' })?.summary).toBe(
      'Renamed Oak Chair to Oak Dining Chair',
    );
  });

  it('should list plain field changes', () => {
    expect(describeProductChanges(base, { ...base, description: 'Solid oak', costPrice: 50 })?.summary).toBe(
      'Edited Oak Chair: description, cost price',
    );
  });

  it('should ignore bulk prices when the update did not send them', () => {
    expect(describeProductChanges(base, { ...base, bulkPricingTiers: undefined })).toBeNull();
  });

  it('should return null when nothing changed', () => {
    expect(describeProductChanges(base, { ...base })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run tests/describeProductChanges.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the helpers**

Create `backend/src/utils/money.ts`:

```ts
const euroFormatter = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });

export const formatEuro = (amount: number) => euroFormatter.format(amount);

/** Avoid 0.1 + 0.2 style float noise in money sums. */
export const roundMoney = (amount: number) => Math.round(amount * 100) / 100;
```

Create `backend/src/services/activity/describeProductChanges.ts`:

```ts
import { formatEuro } from '../../utils/money.js';
import type { PricingTier } from '../pricing/bulkPricing.js';

export interface ProductSnapshot {
  name: string;
  description: string | null;
  categoryId: number;
  price: number;
  costPrice: number | null;
  imageUrl: string | null;
  sku: string | null;
  isActive: boolean;
  /** Undefined means "not part of this change". */
  bulkPricingTiers?: PricingTier[];
}

const FIELD_LABELS: Record<keyof ProductSnapshot, string> = {
  name: 'name',
  description: 'description',
  categoryId: 'category',
  price: 'price',
  costPrice: 'cost price',
  imageUrl: 'image',
  sku: 'SKU',
  isActive: 'visibility',
  bulkPricingTiers: 'bulk prices',
};

type FieldChanges = Partial<Record<keyof ProductSnapshot, { from: unknown; to: unknown }>>;

/**
 * Turn a before/after pair into one readable sentence plus the changed
 * fields. Returns null when nothing changed, so no empty entry is logged.
 */
export function describeProductChanges(
  before: ProductSnapshot,
  after: ProductSnapshot,
): { summary: string; details: FieldChanges } | null {
  const details: FieldChanges = {};
  for (const field of Object.keys(FIELD_LABELS) as Array<keyof ProductSnapshot>) {
    if (field === 'bulkPricingTiers' && after.bulkPricingTiers === undefined) continue;
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      details[field] = { from: before[field], to: after[field] };
    }
  }

  const changed = Object.keys(details) as Array<keyof ProductSnapshot>;
  if (changed.length === 0) return null;

  let headline: keyof ProductSnapshot | null = null;
  let summary: string;
  if (details.price) {
    headline = 'price';
    summary = `Changed price of ${after.name} from ${formatEuro(before.price)} to ${formatEuro(after.price)}`;
  } else if (details.isActive) {
    headline = 'isActive';
    summary = after.isActive ? `Showed ${after.name} in the app` : `Hid ${after.name} from the app`;
  } else if (details.name) {
    headline = 'name';
    summary = `Renamed ${before.name} to ${after.name}`;
  } else {
    summary = `Edited ${after.name}: ${changed.map((field) => FIELD_LABELS[field]).join(', ')}`;
  }

  const others = changed.filter((field) => field !== headline);
  if (headline && others.length > 0) {
    summary += ` (also changed ${others.map((field) => FIELD_LABELS[field]).join(', ')})`;
  }
  return { summary, details };
}
```

- [ ] **Step 4: Run the unit test**

Run: `cd backend && npx vitest run tests/describeProductChanges.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Write the failing integration tests**

Append to `backend/tests/activity.test.ts` (add `createTestCategory` to the helper import):

```ts
describe('catalog activity', () => {
  async function activitySummaries(action: string) {
    const response = await listActivity(`?action=${action}`);
    return response.body.data.map((entry: { summary: string }) => entry.summary);
  }

  it('should log creating, editing, re-pricing and deleting a product', async () => {
    const category = await createTestCategory(context.db);
    const created = await request(context.app)
      .post('/api/products')
      .set(auth(adminToken))
      .send({ name: 'Oak Chair', categoryId: category.id, price: 89, stock: 5 });
    const productId = created.body.data.id;

    await request(context.app)
      .put(`/api/products/${productId}`)
      .set(auth(adminToken))
      .send({ name: 'Oak Chair', categoryId: category.id, price: 95 });
    await request(context.app)
      .put(`/api/pricing/tiers/${productId}`)
      .set(auth(adminToken))
      .send({ tiers: [{ quantity: 10, price: 90 }] });
    await request(context.app).delete(`/api/products/${productId}`).set(auth(adminToken));

    expect(await activitySummaries('product,pricing')).toEqual([
      'Deleted product Oak Chair',
      'Updated bulk prices for Oak Chair',
      'Changed price of Oak Chair from €89.00 to €95.00',
      'Added product Oak Chair',
    ]);
  });

  it('should not log a product save that changed nothing', async () => {
    const category = await createTestCategory(context.db);
    const created = await request(context.app)
      .post('/api/products')
      .set(auth(adminToken))
      .send({ name: 'Lamp', categoryId: category.id, price: 30 });

    await request(context.app)
      .put(`/api/products/${created.body.data.id}`)
      .set(auth(adminToken))
      .send({ name: 'Lamp', categoryId: category.id, price: 30 });

    expect(await activitySummaries('product.updated')).toEqual([]);
  });

  it('should log category changes with the admin as the author', async () => {
    const created = await request(context.app).post('/api/categories').set(auth(adminToken)).send({ name: 'Lighting' });
    await request(context.app)
      .put(`/api/categories/${created.body.data.id}`)
      .set(auth(adminToken))
      .send({ name: 'Lamps' });
    await request(context.app).delete(`/api/categories/${created.body.data.id}`).set(auth(adminToken));

    const response = await listActivity('?action=category');

    expect(response.body.data.map((entry: { summary: string }) => entry.summary)).toEqual([
      'Deleted category Lamps',
      'Renamed category Lighting to Lamps',
      'Added category Lighting',
    ]);
    expect(response.body.data[0].user.name).toBe('Test admin');
  });
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `cd backend && npx vitest run tests/activity.test.ts`
Expected: the 3 new tests FAIL (empty lists); the earlier 4 still pass.

- [ ] **Step 7: Log product changes**

In `backend/src/services/ProductService.ts` (add imports: `type ProductSnapshot, describeProductChanges` from `./activity/describeProductChanges.js`):

Inside `create`, in the transaction right after the `if (input.stock > 0) { ... }` block and before `return id;`:

```ts
        await repos.activityLog.create({
          userId: createdBy,
          action: 'product.created',
          entityType: 'product',
          entityId: id,
          summary: `Added product ${input.name}`,
          details: { price: input.price, stock: input.stock },
        });
```

Replace `update` and `delete` with:

```ts
  /** Full update. Stock is deliberately not editable here; use the inventory endpoint. */
  async update(id: number, input: ProductInput, actorId: number): Promise<ProductDto> {
    const existing = await this.productRepository.findById(id, true);
    if (!existing) throw new NotFoundError(`Product ${id} does not exist`);
    await this.ensureCategoryExists(input.categoryId);

    const existingTiers = await this.pricingTierRepository.findByProductId(id);
    // If the price changed but tiers were not sent, the existing tiers must
    // still be valid against the new price.
    const tiers = validatePricingTiers(input.price, input.bulkPricingTiers ?? existingTiers);
    const change = describeProductChanges(toSnapshot(existing, existingTiers), {
      name: input.name,
      description: input.description,
      categoryId: input.categoryId,
      price: input.price,
      costPrice: input.costPrice,
      imageUrl: input.imageUrl,
      sku: input.sku,
      isActive: input.isActive,
      bulkPricingTiers: input.bulkPricingTiers ? tiers : undefined,
    });

    try {
      await this.transactions.run(async (repos) => {
        await repos.products.update(id, this.toProductData(input));
        if (input.bulkPricingTiers) await repos.pricingTiers.replaceForProduct(id, tiers);
        if (change) {
          await repos.activityLog.create({
            userId: actorId,
            action: 'product.updated',
            entityType: 'product',
            entityId: id,
            summary: change.summary,
            details: change.details,
          });
        }
      });
    } catch (error) {
      if (isUniqueViolation(error) && input.sku) throw new ConflictError(SKU_TAKEN_MESSAGE(input.sku));
      throw error;
    }
    return this.getById(id, 'admin');
  }

  /** Soft delete: hidden everywhere, but sales history keeps pointing at it. */
  async delete(id: number, actorId: number): Promise<void> {
    const existing = await this.productRepository.findById(id, true);
    if (!existing) throw new NotFoundError(`Product ${id} does not exist`);

    await this.transactions.run(async (repos) => {
      await repos.products.softDelete(id);
      await repos.activityLog.create({
        userId: actorId,
        action: 'product.deleted',
        entityType: 'product',
        entityId: id,
        summary: `Deleted product ${existing.name}`,
      });
    });
  }
```

Add at the bottom of the file:

```ts
function toSnapshot(product: ProductRecord, tiers: PricingTier[]): ProductSnapshot {
  return {
    name: product.name,
    description: product.description,
    categoryId: product.category_id,
    price: toMoney(product.base_price),
    costPrice: toMoneyOrNull(product.cost_price),
    imageUrl: product.image_url,
    sku: product.sku,
    isActive: product.is_active,
    bulkPricingTiers: tiers,
  };
}
```

- [ ] **Step 8: Log price-tier changes**

Replace `replaceTiers` in `backend/src/services/PricingService.ts`:

```ts
  async replaceTiers(productId: number, tiers: PricingTier[], actorId: number): Promise<PricingTiersDto> {
    const product = await this.productRepository.findById(productId, true);
    if (!product) throw new NotFoundError(`Product ${productId} does not exist`);

    const basePrice = toMoney(product.base_price);
    const sortedTiers = validatePricingTiers(basePrice, tiers);
    const previousTiers = await this.pricingTierRepository.findByProductId(productId);

    await this.transactions.run(async (repos) => {
      await repos.pricingTiers.replaceForProduct(productId, sortedTiers);
      await repos.activityLog.create({
        userId: actorId,
        action: 'pricing.updated',
        entityType: 'product',
        entityId: productId,
        summary: `Updated bulk prices for ${product.name}`,
        details: { from: previousTiers, to: sortedTiers },
      });
    });
    return { productId, basePrice, tiers: sortedTiers };
  }
```

- [ ] **Step 9: Log category changes atomically**

Replace the class in `backend/src/services/CategoryService.ts` (keep the two interfaces; add `import type { TransactionManager } from '../repositories/TransactionManager.js';`):

```ts
export class CategoryService {
  constructor(
    private readonly categoryRepository: CategoryRepository,
    private readonly transactions: TransactionManager,
  ) {}

  async list(): Promise<CategoryDto[]> {
    const categories = await this.categoryRepository.findAll();
    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      description: category.description,
      productCount: category.product_count,
    }));
  }

  async create(input: CategoryInput, actorId: number): Promise<CategoryDto> {
    await this.ensureNameIsFree(input.name);
    try {
      return await this.transactions.run(async (repos) => {
        const category = await repos.categories.create(input);
        await repos.activityLog.create({
          userId: actorId,
          action: 'category.created',
          entityType: 'category',
          entityId: category.id,
          summary: `Added category ${category.name}`,
        });
        return { id: category.id, name: category.name, description: category.description };
      });
    } catch (error) {
      // Two admins creating the same name at once: the unique index catches it.
      if (isUniqueViolation(error)) throw this.duplicateNameError(input.name);
      throw error;
    }
  }

  async update(id: number, input: CategoryInput, actorId: number): Promise<CategoryDto> {
    const existing = await this.categoryRepository.findById(id);
    if (!existing) throw new NotFoundError(`Category ${id} does not exist`);
    await this.ensureNameIsFree(input.name, id);

    try {
      return await this.transactions.run(async (repos) => {
        const category = await repos.categories.update(id, input);
        if (!category) throw new NotFoundError(`Category ${id} does not exist`);
        await repos.activityLog.create({
          userId: actorId,
          action: 'category.updated',
          entityType: 'category',
          entityId: id,
          summary:
            existing.name === category.name
              ? `Edited category ${category.name}`
              : `Renamed category ${existing.name} to ${category.name}`,
          details: { from: { name: existing.name, description: existing.description }, to: input },
        });
        return { id: category.id, name: category.name, description: category.description };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw this.duplicateNameError(input.name);
      throw error;
    }
  }

  /** Refuses while products still use it, so no product is left without a category. */
  async delete(id: number, actorId: number): Promise<void> {
    const category = await this.categoryRepository.findById(id);
    if (!category) throw new NotFoundError(`Category ${id} does not exist`);

    const productCount = await this.categoryRepository.countProducts(id);
    if (productCount > 0) {
      throw new ConflictError(`"${category.name}" still has ${productCount} product(s). Move or delete them first.`);
    }
    await this.transactions.run(async (repos) => {
      await repos.categories.softDelete(id);
      await repos.activityLog.create({
        userId: actorId,
        action: 'category.deleted',
        entityType: 'category',
        entityId: id,
        summary: `Deleted category ${category.name}`,
      });
    });
  }

  private async ensureNameIsFree(name: string, exceptId?: number): Promise<void> {
    const existing = await this.categoryRepository.findByName(name);
    if (existing && existing.id !== exceptId) throw this.duplicateNameError(name);
  }

  private duplicateNameError(name: string): ConflictError {
    return new ConflictError(`A category named "${name}" already exists`);
  }
}
```

In `backend/src/container.ts` change to `new CategoryService(categoryRepository, transactions)`.

- [ ] **Step 10: Pass the acting user from the controllers**

- `productController.ts`: `productService.update(id, input, req.user!.id)` and `productService.delete(id, req.user!.id)`.
- `pricingController.ts`: `pricingService.replaceTiers(productId, tiers, req.user!.id)`.
- `categoryController.ts`: `categoryService.create(input, req.user!.id)`, `categoryService.update(id, input, req.user!.id)`, `categoryService.delete(id, req.user!.id)`.

- [ ] **Step 11: Run all tests**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: all pass.

- [ ] **Step 12: Commit**

```bash
git add backend
git commit -m "feat: Log product, price and category changes" -m "Every product added, edited or deleted, every bulk price change and every category change now lands in the activity log with who did it. Edits read like 'Changed price of Oak Chair from €89.00 to €95.00', and saving a product without changing anything adds nothing. Each entry is saved together with the change, so a failed change never leaves a log entry behind." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Log stock, sales, people and logins

**Files:**
- Modify: `backend/src/services/InventoryService.ts` (`adjust`, `applyStockChange` return value)
- Modify: `backend/src/services/SalesService.ts` (`record`)
- Modify: `backend/src/services/UserService.ts` (writes go through transactions)
- Modify: `backend/src/services/AuthService.ts` (`login`)
- Modify: `backend/src/controllers/operationsControllers.ts` (`userService.create(input, req.user!.id)`)
- Modify: `backend/src/container.ts`
- Test: `backend/tests/activity.test.ts` (append)

**Interfaces:**
- Consumes: `repos.activityLog`, `repos.users` (Task 2); `formatEuro`, `roundMoney` (Task 3).
- Produces: `applyStockChange(...)` now returns `Promise<{ before: number; after: number }>`; `UserService` constructor `(userRepository, refreshTokenRepository, transactions)`; `UserService.create(input, actorId)`; `AuthService` constructor `(userRepository, refreshTokenRepository, activityLogRepository, config)`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/activity.test.ts`:

```ts
describe('stock, sales, people and login activity', () => {
  async function createProduct() {
    const category = await createTestCategory(context.db);
    const created = await request(context.app)
      .post('/api/products')
      .set(auth(adminToken))
      .send({ name: 'Oak Chair', categoryId: category.id, price: 100, stock: 20, reorderLevel: 5 });
    return created.body.data.id as number;
  }

  it('should log stock adjustments and reorder level changes', async () => {
    const productId = await createProduct();

    await request(context.app)
      .patch(`/api/inventory/${productId}`)
      .set(auth(adminToken))
      .send({ quantity: -3, reason: 'Damage', reorderLevel: 8 });
    const response = await listActivity('?action=stock');

    expect(response.body.data.map((entry: { summary: string }) => entry.summary)).toEqual([
      'Removed 3 from Oak Chair (Damage)',
      'Changed reorder level of Oak Chair from 5 to 8',
    ]);
    expect(response.body.data[0].details).toMatchObject({ quantity: -3, before: 20, after: 17 });
  });

  it('should log nothing when a stock adjustment fails', async () => {
    const productId = await createProduct();

    await request(context.app)
      .patch(`/api/inventory/${productId}`)
      .set(auth(adminToken))
      .send({ quantity: -500, reason: 'Damage', reorderLevel: 1 });
    const response = await listActivity('?action=stock');

    expect(response.body.data).toEqual([]);
  });

  it('should log a sale with the seller', async () => {
    const productId = await createProduct();
    const employeeToken = await loginAs(context, 'employee');

    await request(context.app).post('/api/sales').set(auth(employeeToken)).send({ productId, quantity: 2 });
    const response = await listActivity('?action=sale.recorded');

    expect(response.body.data[0]).toMatchObject({
      summary: 'Sold 2 × Oak Chair for €200.00',
      entityType: 'sale',
      user: { name: 'Test employee' },
    });
  });

  it('should log people changes without ever storing a password', async () => {
    const created = await request(context.app)
      .post('/api/users')
      .set(auth(adminToken))
      .send({ email: 'sam@test.local', name: 'Sam', role: 'employee', password: 'first-secret-pw' });
    const samId = created.body.data.id;
    await request(context.app)
      .put(`/api/users/${samId}`)
      .set(auth(adminToken))
      .send({ role: 'family', password: 'second-secret-pw' });
    await request(context.app).delete(`/api/users/${samId}`).set(auth(adminToken));

    const response = await listActivity('?action=user');

    expect(response.body.data.map((entry: { summary: string }) => entry.summary)).toEqual([
      'Removed Sam',
      "Changed Sam's role from employee to family; set a new password for Sam",
      'Added Sam as employee',
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(/secret-pw/);
  });

  it('should log logins', async () => {
    const response = await listActivity('?action=auth.logged_in');

    // beforeEach logged the admin in once.
    expect(response.body.data.map((entry: { summary: string }) => entry.summary)).toEqual(['Test admin logged in']);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run tests/activity.test.ts`
Expected: the 5 new tests FAIL; earlier ones pass.

- [ ] **Step 3: Log stock adjustments**

In `backend/src/services/InventoryService.ts`, change the signature line of `applyStockChange` to return the before/after numbers:

```ts
): Promise<{ before: number; after: number }> {
```

and make its last line `return result;` (after the alert block).

Replace the transaction inside `adjust` with:

```ts
    await this.transactions.run(async (repos) => {
      if (input.reorderLevel !== undefined && input.reorderLevel !== item.reorder_level) {
        await repos.inventory.setReorderLevel(productId, input.reorderLevel);
        await repos.activityLog.create({
          userId: adjustedBy,
          action: 'stock.adjusted',
          entityType: 'product',
          entityId: productId,
          summary: `Changed reorder level of ${item.product_name} from ${item.reorder_level} to ${input.reorderLevel}`,
          details: { reorderLevel: { from: item.reorder_level, to: input.reorderLevel } },
        });
      }
      if (input.quantity !== undefined) {
        const reason = input.reason ?? 'Manual adjustment';
        const { before, after } = await applyStockChange(repos, {
          productId,
          productName: item.product_name,
          delta: input.quantity,
          reason,
          notes: input.notes,
          adjustedBy,
          reorderLevel: input.reorderLevel ?? item.reorder_level,
        });
        const amount = Math.abs(input.quantity);
        await repos.activityLog.create({
          userId: adjustedBy,
          action: 'stock.adjusted',
          entityType: 'product',
          entityId: productId,
          summary:
            input.quantity > 0
              ? `Added ${amount} to ${item.product_name} (${reason})`
              : `Removed ${amount} from ${item.product_name} (${reason})`,
          details: { quantity: input.quantity, reason, notes: input.notes, before, after },
        });
      }
    });
```

- [ ] **Step 4: Log sales**

In `backend/src/services/SalesService.ts` (add `import { formatEuro, roundMoney } from '../utils/money.js';`), inside the transaction in `record`, between `applyStockChange(...)` and `return id;`:

```ts
      await repos.activityLog.create({
        userId: soldBy,
        action: 'sale.recorded',
        entityType: 'sale',
        entityId: id,
        summary: `Sold ${input.quantity} × ${product.name} for ${formatEuro(roundMoney(pricePerUnit * input.quantity))}`,
        details: { productId: product.id, quantity: input.quantity, pricePerUnit },
      });
```

- [ ] **Step 5: Log people changes atomically**

Replace the class in `backend/src/services/UserService.ts` (keep the interfaces; add `import type { TransactionManager } from '../repositories/TransactionManager.js';`):

```ts
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly transactions: TransactionManager,
  ) {}

  async list(query: PageRequest & { role?: UserRole }): Promise<Paginated<PublicUser>> {
    const { users, total } = await this.userRepository.findAll({
      role: query.role,
      limit: query.limit,
      offset: toOffset(query),
    });
    return { items: users.map(toPublicUser), meta: toPaginationMeta(query, total) };
  }

  async create(input: CreateUserInput, actorId: number): Promise<PublicUser> {
    const existing = await this.userRepository.findByEmail(input.email);
    if (existing) throw new ConflictError(`An account for ${input.email} already exists`);
    const passwordHash = await hashPassword(input.password);

    try {
      return await this.transactions.run(async (repos) => {
        const user = await repos.users.create({
          email: input.email,
          name: input.name,
          role: input.role,
          password_hash: passwordHash,
        });
        await repos.activityLog.create({
          userId: actorId,
          action: 'user.created',
          entityType: 'user',
          entityId: user.id,
          summary: `Added ${user.name} as ${user.role}`,
          details: { email: user.email, role: user.role },
        });
        return toPublicUser(user);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError(`An account for ${input.email} already exists`);
      throw error;
    }
  }

  async update(id: number, input: UpdateUserInput, actingUserId: number): Promise<PublicUser> {
    const user = await this.userRepository.findById(id);
    if (!user) throw new NotFoundError(`User ${id} does not exist`);

    const losesAdmin = user.role === 'admin' && ((input.role && input.role !== 'admin') || input.isActive === false);
    if (losesAdmin) await this.ensureAnotherAdminRemains(id === actingUserId);
    const passwordHash = input.password === undefined ? undefined : await hashPassword(input.password);

    const updated = await this.transactions.run(async (repos) => {
      const result = await repos.users.update(id, {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.role !== undefined && { role: input.role }),
        ...(input.isActive !== undefined && { is_active: input.isActive }),
        ...(passwordHash !== undefined && { password_hash: passwordHash }),
      });
      if (!result) throw new NotFoundError(`User ${id} does not exist`);
      await repos.activityLog.create({
        userId: actingUserId,
        action: 'user.updated',
        entityType: 'user',
        entityId: id,
        summary: describeUserChanges(user.name, user.role, user.is_active, input),
        // Never the password itself, only that it changed.
        details: {
          ...(input.name !== undefined && { name: { from: user.name, to: input.name } }),
          ...(input.role !== undefined && { role: { from: user.role, to: input.role } }),
          ...(input.isActive !== undefined && { isActive: { from: user.is_active, to: input.isActive } }),
          ...(input.password !== undefined && { passwordChanged: true }),
        },
      });
      return result;
    });

    // A new password or lost access should end their other sessions straight away.
    if (input.password !== undefined || input.isActive === false || (input.role && input.role !== user.role)) {
      await this.refreshTokenRepository.revokeAllForUser(id);
    }
    return toPublicUser(updated);
  }

  async delete(id: number, actingUserId: number): Promise<void> {
    if (id === actingUserId) throw new ValidationError("You can't delete your own account");

    const user = await this.userRepository.findById(id);
    if (!user) throw new NotFoundError(`User ${id} does not exist`);
    if (user.role === 'admin') await this.ensureAnotherAdminRemains(false);

    await this.transactions.run(async (repos) => {
      await repos.users.softDelete(id);
      await repos.activityLog.create({
        userId: actingUserId,
        action: 'user.deleted',
        entityType: 'user',
        entityId: id,
        summary: `Removed ${user.name}`,
      });
    });
    await this.refreshTokenRepository.revokeAllForUser(id);
  }

  /** Never let the app end up with nobody who can manage it. */
  private async ensureAnotherAdminRemains(isSelf: boolean): Promise<void> {
    if ((await this.userRepository.countActiveAdmins()) <= 1) {
      throw new ConflictError(
        isSelf
          ? "You're the only admin. Make someone else an admin first."
          : 'This is the only admin left. Make someone else an admin first.',
      );
    }
  }
}

function describeUserChanges(name: string, role: UserRole, isActive: boolean, input: UpdateUserInput): string {
  const parts: string[] = [];
  if (input.name !== undefined && input.name !== name) parts.push(`renamed ${name} to ${input.name}`);
  if (input.role !== undefined && input.role !== role) parts.push(`changed ${name}'s role from ${role} to ${input.role}`);
  if (input.isActive === false && isActive) parts.push(`blocked ${name}`);
  if (input.isActive === true && !isActive) parts.push(`let ${name} back in`);
  if (input.password !== undefined) parts.push(`set a new password for ${name}`);
  const sentence = parts.length > 0 ? parts.join('; ') : `saved ${name} with no changes`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
```

- [ ] **Step 6: Log logins**

In `backend/src/services/AuthService.ts`, add the repository import (`import type { ActivityLogRepository } from '../repositories/ActivityLogRepository.js';`), add it to the constructor before `config`:

```ts
  constructor(
    private readonly userRepository: UserRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly activityLogRepository: ActivityLogRepository,
    private readonly config: AuthConfig,
  ) {}
```

and in `login`, after `const publicUser = toPublicUser(user);`:

```ts
    await this.activityLogRepository.create({
      userId: user.id,
      action: 'auth.logged_in',
      entityType: 'user',
      entityId: user.id,
      summary: `${user.name} logged in`,
    });
```

- [ ] **Step 7: Update the wiring and controller**

In `backend/src/container.ts`: `new AuthService(userRepository, refreshTokenRepository, activityLogRepository, config)` and `new UserService(userRepository, refreshTokenRepository, transactions)`. Move the `activityLogRepository` creation above `authService` if needed.

In `backend/src/controllers/operationsControllers.ts`, in `createUserController.create`: `userService.create(input, req.user!.id)`.

- [ ] **Step 8: Run all tests**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: all pass. (Existing tests are unaffected, since only new entries are added.)

- [ ] **Step 9: Commit**

```bash
git add backend
git commit -m "feat: Log stock changes, sales, people changes and logins" -m "The activity log now covers everything in the plan: stock added or removed (with the reason and the before and after count), reorder levels, every sale with who made it, people added, changed or removed, and every login. Passwords are never written to the log, only the fact that one was changed. A refused change, like removing more stock than there is, leaves nothing behind." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Report maths and CSV helper

**Files:**
- Create: `backend/src/services/reports/calculations.ts`
- Create: `backend/src/utils/csv.ts`
- Test: `backend/tests/reportCalculations.test.ts` (new)

**Interfaces:**
- Produces:
  - `relativeChange(current: number, previous: number): number | null`
  - `previousRange(range: { startDate: Date; endDate: Date }): { startDate: Date; endDate: Date }`
  - `margin(profit: number, revenueWithKnownCost: number): number | null`
  - `reorderSuggestion(input: { unitsSoldLast30Days: number; quantity: number; reorderLevel: number }): { averageDailySales: number; daysLeft: number | null; suggestedOrder: number }`
  - `REORDER_WINDOW_DAYS = 30`
  - `interface CsvColumn<TRow> { header: string; value: (row: TRow) => string | number | null }`
  - `toCsv<TRow>(columns: CsvColumn<TRow>[], rows: TRow[]): string`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/reportCalculations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { margin, previousRange, relativeChange, reorderSuggestion } from '../src/services/reports/calculations.js';
import { toCsv } from '../src/utils/csv.js';

describe('relativeChange', () => {
  it('should return the change as a fraction', () => {
    expect(relativeChange(150, 100)).toBe(0.5);
    expect(relativeChange(75, 100)).toBe(-0.25);
  });

  it('should return null when there is nothing to compare against', () => {
    expect(relativeChange(100, 0)).toBeNull();
    expect(relativeChange(0, 0)).toBeNull();
  });
});

describe('previousRange', () => {
  it('should be the same length, ending where the current one starts', () => {
    const range = previousRange({
      startDate: new Date('2026-03-01T00:00:00Z'),
      endDate: new Date('2026-03-11T00:00:00Z'),
    });

    expect(range).toEqual({
      startDate: new Date('2026-02-19T00:00:00Z'),
      endDate: new Date('2026-03-01T00:00:00Z'),
    });
  });
});

describe('margin', () => {
  it('should divide profit by the revenue whose cost is known', () => {
    expect(margin(120, 300)).toBe(0.4);
  });

  it('should be null without revenue of known cost', () => {
    expect(margin(0, 0)).toBeNull();
  });
});

describe('reorderSuggestion', () => {
  it('should estimate days left and how many to order for the next 30 days', () => {
    expect(reorderSuggestion({ unitsSoldLast30Days: 15, quantity: 15, reorderLevel: 10 })).toEqual({
      averageDailySales: 0.5,
      daysLeft: 30,
      suggestedOrder: 10,
    });
  });

  it('should round days left down', () => {
    expect(reorderSuggestion({ unitsSoldLast30Days: 30, quantity: 5, reorderLevel: 0 }).daysLeft).toBe(5);
    expect(reorderSuggestion({ unitsSoldLast30Days: 9, quantity: 10, reorderLevel: 0 }).daysLeft).toBe(33);
  });

  it('should not guess a run-out date without recent sales', () => {
    expect(reorderSuggestion({ unitsSoldLast30Days: 0, quantity: 4, reorderLevel: 10 })).toEqual({
      averageDailySales: 0,
      daysLeft: null,
      suggestedOrder: 6,
    });
  });

  it('should never suggest a negative order', () => {
    expect(reorderSuggestion({ unitsSoldLast30Days: 3, quantity: 500, reorderLevel: 10 }).suggestedOrder).toBe(0);
  });
});

describe('toCsv', () => {
  const columns = [
    { header: 'Product', value: (row: { name: string; qty: number | null }) => row.name },
    { header: 'Qty', value: (row: { name: string; qty: number | null }) => row.qty },
  ];

  it('should start with a BOM and use CRLF line endings', () => {
    expect(toCsv(columns, [{ name: 'Chair', qty: 2 }])).toBe('﻿Product,Qty\r\nChair,2\r\n');
  });

  it('should quote cells with commas, quotes or line breaks', () => {
    const csv = toCsv(columns, [{ name: 'Chair, "oak"\nlarge', qty: 1 }]);

    expect(csv).toContain('"Chair, ""oak""\nlarge",1');
  });

  it('should defuse cells that Excel would run as formulas', () => {
    const csv = toCsv(columns, [
      { name: '=HYPERLINK("x")', qty: 1 },
      { name: '+1', qty: 1 },
      { name: '-1', qty: 1 },
      { name: '@SUM(A1)', qty: 1 },
    ]);

    expect(csv).toContain(`"'=HYPERLINK(""x"")",1`);
    expect(csv).toContain("'+1,1");
    expect(csv).toContain("'-1,1");
    expect(csv).toContain("'@SUM(A1),1");
  });

  it('should leave numbers alone, including negative ones, and write null as empty', () => {
    expect(toCsv(columns, [{ name: 'Chair', qty: -3 }])).toContain('Chair,-3');
    expect(toCsv(columns, [{ name: 'Chair', qty: null }])).toContain('Chair,\r\n');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run tests/reportCalculations.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement**

Create `backend/src/services/reports/calculations.ts`:

```ts
export const REORDER_WINDOW_DAYS = 30;

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/** 0.25 means +25%. Null when the previous value was 0, since any change from 0 is infinite. */
export function relativeChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return round((current - previous) / previous, 4);
}

/** The same length of time, immediately before `range`. */
export function previousRange(range: DateRange): DateRange {
  const length = range.endDate.getTime() - range.startDate.getTime();
  return { startDate: new Date(range.startDate.getTime() - length), endDate: range.startDate };
}

export function margin(profit: number, revenueWithKnownCost: number): number | null {
  if (revenueWithKnownCost === 0) return null;
  return round(profit / revenueWithKnownCost, 4);
}

/**
 * Based on the last 30 days of sales: how long current stock lasts, and how
 * many to order so there's enough for the next 30 days plus the reorder buffer.
 */
export function reorderSuggestion(input: { unitsSoldLast30Days: number; quantity: number; reorderLevel: number }) {
  const perDay = input.unitsSoldLast30Days / REORDER_WINDOW_DAYS;
  const neededForWindow = perDay * REORDER_WINDOW_DAYS;
  return {
    averageDailySales: round(perDay, 2),
    daysLeft: perDay === 0 ? null : Math.floor(input.quantity / perDay),
    suggestedOrder: Math.max(0, Math.ceil(neededForWindow + input.reorderLevel - input.quantity)),
  };
}
```

Create `backend/src/utils/csv.ts`:

```ts
export interface CsvColumn<TRow> {
  header: string;
  value: (row: TRow) => string | number | null;
}

// Spreadsheet apps run cells starting with these as formulas (CSV injection).
const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

function formatCell(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);

  const safe = FORMULA_TRIGGERS.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * CSV that opens cleanly in Excel: the byte-order mark makes it read UTF-8
 * (so € and accents survive), and lines end in CRLF.
 */
export function toCsv<TRow>(columns: CsvColumn<TRow>[], rows: TRow[]): string {
  const lines = [
    columns.map((column) => formatCell(column.header)).join(','),
    ...rows.map((row) => columns.map((column) => formatCell(column.value(row))).join(',')),
  ];
  return `﻿${lines.join('\r\n')}\r\n`;
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npx vitest run tests/reportCalculations.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat: Add the maths behind reports and a safe CSV writer" -m "Small tested helpers the reports build on: percentage change against the previous period, margin, how many days stock will last and how many to reorder, and a CSV writer that opens correctly in Excel and can't be tricked into running formulas." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Report endpoints

**Files:**
- Create: `backend/src/repositories/ReportsRepository.ts`
- Create: `backend/src/services/ReportsService.ts`
- Create: `backend/src/validators/reportValidators.ts`
- Create: `backend/src/controllers/reportsController.ts`
- Create: `backend/src/routes/reportsRoutes.ts`
- Modify: `backend/src/validators/operationsValidators.ts` (export `startDateQuery`, `endDateQuery`)
- Modify: `backend/src/container.ts`, `backend/src/routes/index.ts`
- Test: `backend/tests/reports.test.ts` (append)

**Interfaces:**
- Consumes: Task 5 helpers; `sales.unit_cost` (Task 1).
- Produces (used by Task 7 and the front ends):
  - `ReportsService.summary(range): Promise<{ current: PeriodTotals; previous: PeriodTotals; change: { revenue; profit; unitsSold; salesCount } }>` where `PeriodTotals = { revenue; revenueWithoutCost; cost; profit; margin: number | null; unitsSold; salesCount }`
  - `ReportsService.team(range): Promise<TeamRow[]>`, `TeamRow = { userId; name; role; salesCount; unitsSold; revenue; profit; averageSale }`
  - `ReportsService.profit(range, groupBy: 'product' | 'category'): Promise<ProfitRow[]>`, `ProfitRow = { id; name; unitsSold; revenue; cost; profit; margin: number | null; hasUnknownCost: boolean }`
  - `ReportsService.reorderSuggestions(): Promise<ReorderRow[]>`, `ReorderRow = { productId; productName; quantity; reorderLevel; averageDailySales; daysLeft: number | null; suggestedOrder }`
  - `ReportsService.mySales(userId, range)`
  - `reportRangeSchema` (zod) producing `{ startDate: Date; endDate: Date }`
  - Routes under `/api/reports`: `summary`, `team`, `profit`, `reorder-suggestions` (admin); `my-sales` (admin, employee)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/reports.test.ts` (add `createTestUser` to the helper import):

```ts
const MARCH = 'startDate=2026-03-01&endDate=2026-03-31';

describe('GET /api/reports/summary', () => {
  it('should total the period and compare it with the period before', async () => {
    const productId = await createProduct();
    const employeeToken = await loginAs(context, 'employee');
    await sell(employeeToken, productId, 2, '2026-03-10T12:00:00Z');
    await sell(adminToken, productId, 1, '2026-03-20T12:00:00Z');
    await sell(adminToken, productId, 1, '2026-02-15T12:00:00Z');

    const response = await request(context.app).get(`/api/reports/summary?${MARCH}`).set(auth(adminToken));

    expect(response.status).toBe(200);
    expect(response.body.data.current).toEqual({
      revenue: 300,
      revenueWithoutCost: 0,
      cost: 180,
      profit: 120,
      margin: 0.4,
      unitsSold: 3,
      salesCount: 2,
    });
    expect(response.body.data.previous.revenue).toBe(100);
    expect(response.body.data.change).toEqual({ revenue: 2, profit: 2, unitsSold: 2, salesCount: 1 });
  });

  it('should keep products without a cost out of profit and margin', async () => {
    const withCost = await createProduct();
    const withoutCost = await createProduct({ name: 'Mystery Lamp', costPrice: null });
    await sell(adminToken, withCost, 1, '2026-03-05T12:00:00Z');
    await sell(adminToken, withoutCost, 1, '2026-03-05T12:00:00Z');

    const response = await request(context.app).get(`/api/reports/summary?${MARCH}`).set(auth(adminToken));

    expect(response.body.data.current).toMatchObject({ revenue: 200, revenueWithoutCost: 100, profit: 40, margin: 0.4 });
  });

  it('should report no change instead of infinity when the previous period was empty', async () => {
    const productId = await createProduct();
    await sell(adminToken, productId, 1, '2026-03-05T12:00:00Z');

    const response = await request(context.app).get(`/api/reports/summary?${MARCH}`).set(auth(adminToken));

    expect(response.body.data.change.revenue).toBeNull();
  });

  it('should include sales late on a date-only end date', async () => {
    const productId = await createProduct();
    await sell(adminToken, productId, 1, '2026-03-31T22:30:00Z');

    const response = await request(context.app).get(`/api/reports/summary?${MARCH}`).set(auth(adminToken));

    expect(response.body.data.current.salesCount).toBe(1);
  });

  it('should reject ranges that are backwards or longer than a year', async () => {
    const backwards = await request(context.app)
      .get('/api/reports/summary?startDate=2026-03-31&endDate=2026-03-01')
      .set(auth(adminToken));
    const tooLong = await request(context.app)
      .get('/api/reports/summary?startDate=2024-01-01&endDate=2026-01-01')
      .set(auth(adminToken));
    const missing = await request(context.app).get('/api/reports/summary').set(auth(adminToken));

    expect(backwards.status).toBe(400);
    expect(tooLong.status).toBe(400);
    expect(missing.status).toBe(400);
  });

  it('should be admin only', async () => {
    const employeeToken = await loginAs(context, 'employee');

    const response = await request(context.app).get(`/api/reports/summary?${MARCH}`).set(auth(employeeToken));

    expect(response.status).toBe(403);
  });
});

describe('GET /api/reports/team', () => {
  it('should total each seller, include people with no sales, and sort by revenue', async () => {
    const productId = await createProduct();
    const employeeToken = await loginAs(context, 'employee');
    await createTestUser(context.db, 'employee', { email: 'quiet@test.local' });
    await sell(employeeToken, productId, 2, '2026-03-10T12:00:00Z');
    await sell(employeeToken, productId, 1, '2026-03-11T12:00:00Z');
    await sell(adminToken, productId, 1, '2026-03-12T12:00:00Z');

    const response = await request(context.app).get(`/api/reports/team?${MARCH}`).set(auth(adminToken));

    expect(response.body.data).toEqual([
      expect.objectContaining({ name: 'Test employee', salesCount: 2, unitsSold: 3, revenue: 300, profit: 120, averageSale: 150 }),
      expect.objectContaining({ name: 'Test admin', salesCount: 1, revenue: 100, averageSale: 100 }),
      expect.objectContaining({ salesCount: 0, revenue: 0, averageSale: 0 }),
    ]);
  });

  it('should keep sales of someone who has since been removed', async () => {
    const productId = await createProduct();
    const leaver = await createTestUser(context.db, 'employee', { email: 'leaver@test.local' });
    const leaverLogin = await request(context.app)
      .post('/api/auth/login')
      .send({ email: 'leaver@test.local', password: 'correct-horse-battery' });
    await sell(leaverLogin.body.data.token, productId, 1, '2026-03-10T12:00:00Z');
    await request(context.app).delete(`/api/users/${leaver.id}`).set(auth(adminToken));

    const response = await request(context.app).get(`/api/reports/team?${MARCH}`).set(auth(adminToken));

    expect(response.body.data).toContainEqual(expect.objectContaining({ userId: leaver.id, revenue: 100 }));
  });
});

describe('GET /api/reports/profit', () => {
  it('should break profit down by product, flagging unknown costs', async () => {
    const chair = await createProduct();
    const lamp = await createProduct({ name: 'Mystery Lamp', costPrice: null });
    await sell(adminToken, chair, 2, '2026-03-05T12:00:00Z');
    await sell(adminToken, lamp, 1, '2026-03-05T12:00:00Z');

    const response = await request(context.app)
      .get(`/api/reports/profit?${MARCH}&groupBy=product`)
      .set(auth(adminToken));

    expect(response.body.data).toEqual([
      { id: chair, name: 'Oak Chair', unitsSold: 2, revenue: 200, cost: 120, profit: 80, margin: 0.4, hasUnknownCost: false },
      { id: lamp, name: 'Mystery Lamp', unitsSold: 1, revenue: 100, cost: 0, profit: 0, margin: null, hasUnknownCost: true },
    ]);
  });

  it('should group by category and still count products that were hidden later', async () => {
    const chair = await createProduct();
    await sell(adminToken, chair, 1, '2026-03-05T12:00:00Z');
    await context.db.updateTable('products').set({ is_active: false }).where('id', '=', chair).execute();

    const response = await request(context.app)
      .get(`/api/reports/profit?${MARCH}&groupBy=category`)
      .set(auth(adminToken));

    expect(response.body.data).toEqual([expect.objectContaining({ name: 'Furniture', revenue: 100, profit: 40 })]);
  });

  it('should reject an unknown grouping', async () => {
    const response = await request(context.app)
      .get(`/api/reports/profit?${MARCH}&groupBy=colour`)
      .set(auth(adminToken));

    expect(response.status).toBe(400);
  });
});

describe('GET /api/reports/reorder-suggestions', () => {
  it('should estimate when each product runs out, soonest first', async () => {
    const fast = await createProduct({ name: 'Fast seller', stock: 30, reorderLevel: 10 });
    await createProduct({ name: 'Never sold', stock: 4, reorderLevel: 10 });
    await sell(adminToken, fast, 15);

    const response = await request(context.app).get('/api/reports/reorder-suggestions').set(auth(adminToken));

    expect(response.body.data).toEqual([
      { productId: fast, productName: 'Fast seller', quantity: 15, reorderLevel: 10, averageDailySales: 0.5, daysLeft: 30, suggestedOrder: 10 },
      expect.objectContaining({ productName: 'Never sold', daysLeft: null, suggestedOrder: 6 }),
    ]);
  });
});

describe('GET /api/reports/my-sales', () => {
  it("should show employees only their own numbers, without profit", async () => {
    const productId = await createProduct();
    const employeeToken = await loginAs(context, 'employee');
    await sell(employeeToken, productId, 2, '2026-03-10T12:00:00Z');
    await sell(employeeToken, productId, 1, '2026-02-10T12:00:00Z');
    await sell(adminToken, productId, 5, '2026-03-10T12:00:00Z');

    const response = await request(context.app).get(`/api/reports/my-sales?${MARCH}`).set(auth(employeeToken));

    expect(response.status).toBe(200);
    expect(response.body.data.current).toEqual({ salesCount: 1, unitsSold: 2, revenue: 200 });
    expect(response.body.data.previous).toEqual({ salesCount: 1, unitsSold: 1, revenue: 100 });
    expect(response.body.data.recentSales).toEqual([
      expect.objectContaining({ productName: 'Oak Chair', quantity: 2, totalAmount: 200 }),
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(/profit|cost/i);
  });

  it('should not be available to family members', async () => {
    const familyToken = await loginAs(context, 'family');

    const response = await request(context.app).get(`/api/reports/my-sales?${MARCH}`).set(auth(familyToken));

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run tests/reports.test.ts`
Expected: new tests FAIL with 404s; the two Task 1 tests still pass.

- [ ] **Step 3: Export the date parsers**

In `backend/src/validators/operationsValidators.ts`, change `const startDateQuery` and `const endDateQuery` to `export const startDateQuery` and `export const endDateQuery`.

- [ ] **Step 4: Write the validator**

Create `backend/src/validators/reportValidators.ts`:

```ts
import { z } from 'zod';
import { endDateQuery, startDateQuery } from './operationsValidators.js';

const MAX_RANGE_DAYS = 366;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const reportRangeSchema = z
  .object({ startDate: startDateQuery, endDate: endDateQuery })
  .refine((range) => range.endDate > range.startDate, { message: 'endDate must be after startDate', path: ['endDate'] })
  .refine((range) => range.endDate.getTime() - range.startDate.getTime() <= (MAX_RANGE_DAYS + 1) * MS_PER_DAY, {
    message: `the range can be at most ${MAX_RANGE_DAYS} days`,
    path: ['endDate'],
  });

export const profitQuerySchema = z.object({
  groupBy: z.enum(['product', 'category']).default('product'),
});
```

(The `+ 1` day allows a full year picked as date-only start and end, since the end date is pushed to the next midnight.)

- [ ] **Step 5: Write the repository**

Create `backend/src/repositories/ReportsRepository.ts`:

```ts
import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import type { DateRange } from '../services/reports/calculations.js';

export interface TotalsRow {
  sales_count: string;
  units_sold: string;
  revenue: string;
  revenue_without_cost: string;
  cost: string;
  profit: string;
}

export interface TeamQueryRow {
  user_id: number;
  name: string;
  role: string;
  sales_count: string;
  units_sold: string;
  revenue: string;
  profit: string;
}

export interface ProfitQueryRow {
  id: number;
  name: string;
  units_sold: string;
  revenue: string;
  cost: string;
  profit: string;
  has_unknown_cost: boolean;
}

export interface VelocityRow {
  product_id: number;
  product_name: string;
  sku: string | null;
  category_name: string;
  quantity_on_hand: number;
  reorder_level: number;
  base_price: string;
  cost_price: string | null;
  units_sold_recently: string;
}

export interface MySaleRow {
  id: number;
  product_name: string;
  quantity_sold: number;
  total_amount: string;
  sale_date: Date;
}

export interface SaleExportRow {
  sale_date: Date;
  product_name: string;
  sku: string | null;
  quantity_sold: number;
  price_per_unit: string;
  total_amount: string;
  unit_cost: string | null;
  sold_by_name: string | null;
  notes: string | null;
}

/** All report SQL in one place. Read-only. Ranges are start-inclusive, end-exclusive. */
export class ReportsRepository {
  constructor(private readonly db: DatabaseClient) {}

  async totals(range: DateRange, soldBy?: number): Promise<TotalsRow> {
    const sellerFilter = soldBy === undefined ? sql`` : sql`and s.sold_by = ${soldBy}`;
    const result = await sql<TotalsRow>`
      select
        count(*) as sales_count,
        coalesce(sum(s.quantity_sold), 0) as units_sold,
        coalesce(sum(s.total_amount), 0) as revenue,
        coalesce(sum(s.total_amount) filter (where s.unit_cost is null), 0) as revenue_without_cost,
        coalesce(sum(s.quantity_sold * s.unit_cost) filter (where s.unit_cost is not null), 0) as cost,
        coalesce(sum(s.quantity_sold * (s.price_per_unit - s.unit_cost)) filter (where s.unit_cost is not null), 0) as profit
      from sales s
      where s.sale_date >= ${range.startDate} and s.sale_date < ${range.endDate} ${sellerFilter}
    `.execute(this.db);
    return result.rows[0]!;
  }

  /**
   * Every active admin/employee (so people with no sales show as zero), plus
   * anyone who sold in the period even if they were removed since.
   */
  async team(range: DateRange): Promise<TeamQueryRow[]> {
    const result = await sql<TeamQueryRow>`
      select
        u.id as user_id,
        u.name,
        u.role,
        count(s.id) as sales_count,
        coalesce(sum(s.quantity_sold), 0) as units_sold,
        coalesce(sum(s.total_amount), 0) as revenue,
        coalesce(sum(s.quantity_sold * (s.price_per_unit - s.unit_cost)) filter (where s.unit_cost is not null), 0) as profit
      from users u
      left join sales s
        on s.sold_by = u.id and s.sale_date >= ${range.startDate} and s.sale_date < ${range.endDate}
      where (u.role in ('admin', 'employee') and u.is_active and u.deleted_at is null) or s.id is not null
      group by u.id, u.name, u.role
      order by revenue desc, u.name
    `.execute(this.db);
    return result.rows;
  }

  async profitBy(range: DateRange, groupBy: 'product' | 'category'): Promise<ProfitQueryRow[]> {
    const group = groupBy === 'product' ? sql`p.id, p.name` : sql`c.id, c.name`;
    const result = await sql<ProfitQueryRow>`
      select
        ${group},
        sum(s.quantity_sold) as units_sold,
        sum(s.total_amount) as revenue,
        coalesce(sum(s.quantity_sold * s.unit_cost) filter (where s.unit_cost is not null), 0) as cost,
        coalesce(sum(s.quantity_sold * (s.price_per_unit - s.unit_cost)) filter (where s.unit_cost is not null), 0) as profit,
        bool_or(s.unit_cost is null) as has_unknown_cost
      from sales s
      join products p on p.id = s.product_id
      join categories c on c.id = p.category_id
      where s.sale_date >= ${range.startDate} and s.sale_date < ${range.endDate}
      group by ${group}
      order by profit desc, revenue desc
    `.execute(this.db);
    return result.rows;
  }

  /** Active products with stock and how many sold since `since`. */
  async salesVelocity(since: Date): Promise<VelocityRow[]> {
    const result = await sql<VelocityRow>`
      select
        p.id as product_id,
        p.name as product_name,
        p.sku,
        c.name as category_name,
        i.quantity_on_hand,
        i.reorder_level,
        p.base_price,
        p.cost_price,
        coalesce((
          select sum(s.quantity_sold) from sales s where s.product_id = p.id and s.sale_date >= ${since}
        ), 0) as units_sold_recently
      from products p
      join inventory i on i.product_id = p.id
      join categories c on c.id = p.category_id
      where p.deleted_at is null and p.is_active
      order by p.name
    `.execute(this.db);
    return result.rows;
  }

  async recentSalesBy(soldBy: number, range: DateRange, limit: number): Promise<MySaleRow[]> {
    const result = await sql<MySaleRow>`
      select s.id, p.name as product_name, s.quantity_sold, s.total_amount, s.sale_date
      from sales s
      join products p on p.id = s.product_id
      where s.sold_by = ${soldBy} and s.sale_date >= ${range.startDate} and s.sale_date < ${range.endDate}
      order by s.sale_date desc, s.id desc
      limit ${limit}
    `.execute(this.db);
    return result.rows;
  }

  async salesForExport(range: DateRange): Promise<SaleExportRow[]> {
    const result = await sql<SaleExportRow>`
      select s.sale_date, p.name as product_name, p.sku, s.quantity_sold, s.price_per_unit, s.total_amount,
             s.unit_cost, u.name as sold_by_name, s.notes
      from sales s
      join products p on p.id = s.product_id
      left join users u on u.id = s.sold_by
      where s.sale_date >= ${range.startDate} and s.sale_date < ${range.endDate}
      order by s.sale_date, s.id
    `.execute(this.db);
    return result.rows;
  }
}
```

- [ ] **Step 6: Write the service**

Create `backend/src/services/ReportsService.ts`:

```ts
import type { ReportsRepository, TotalsRow } from '../repositories/ReportsRepository.js';
import { roundMoney } from '../utils/money.js';
import {
  type DateRange,
  margin,
  previousRange,
  REORDER_WINDOW_DAYS,
  relativeChange,
  reorderSuggestion,
} from './reports/calculations.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MY_RECENT_SALES_LIMIT = 10;

export interface PeriodTotals {
  revenue: number;
  revenueWithoutCost: number;
  cost: number;
  profit: number;
  margin: number | null;
  unitsSold: number;
  salesCount: number;
}

export interface TeamRow {
  userId: number;
  name: string;
  role: string;
  salesCount: number;
  unitsSold: number;
  revenue: number;
  profit: number;
  averageSale: number;
}

export interface ProfitRow {
  id: number;
  name: string;
  unitsSold: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number | null;
  hasUnknownCost: boolean;
}

export interface ReorderRow {
  productId: number;
  productName: string;
  quantity: number;
  reorderLevel: number;
  averageDailySales: number;
  daysLeft: number | null;
  suggestedOrder: number;
}

function toPeriodTotals(row: TotalsRow): PeriodTotals {
  const revenue = Number(row.revenue);
  const revenueWithoutCost = Number(row.revenue_without_cost);
  const profit = Number(row.profit);
  return {
    revenue,
    revenueWithoutCost,
    cost: Number(row.cost),
    profit,
    margin: margin(profit, revenue - revenueWithoutCost),
    unitsSold: Number(row.units_sold),
    salesCount: Number(row.sales_count),
  };
}

export class ReportsService {
  constructor(private readonly reportsRepository: ReportsRepository) {}

  async summary(range: DateRange) {
    const [currentRow, previousRow] = await Promise.all([
      this.reportsRepository.totals(range),
      this.reportsRepository.totals(previousRange(range)),
    ]);
    const current = toPeriodTotals(currentRow);
    const previous = toPeriodTotals(previousRow);
    return {
      current,
      previous,
      change: {
        revenue: relativeChange(current.revenue, previous.revenue),
        profit: relativeChange(current.profit, previous.profit),
        unitsSold: relativeChange(current.unitsSold, previous.unitsSold),
        salesCount: relativeChange(current.salesCount, previous.salesCount),
      },
    };
  }

  async team(range: DateRange): Promise<TeamRow[]> {
    const rows = await this.reportsRepository.team(range);
    return rows.map((row) => {
      const salesCount = Number(row.sales_count);
      const revenue = Number(row.revenue);
      return {
        userId: row.user_id,
        name: row.name,
        role: row.role,
        salesCount,
        unitsSold: Number(row.units_sold),
        revenue,
        profit: Number(row.profit),
        averageSale: salesCount === 0 ? 0 : roundMoney(revenue / salesCount),
      };
    });
  }

  async profit(range: DateRange, groupBy: 'product' | 'category'): Promise<ProfitRow[]> {
    const rows = await this.reportsRepository.profitBy(range, groupBy);
    return rows.map((row) => {
      const revenue = Number(row.revenue);
      const cost = Number(row.cost);
      const profit = Number(row.profit);
      // Margin is only meaningful when every sale in the group had a known cost.
      return {
        id: row.id,
        name: row.name,
        unitsSold: Number(row.units_sold),
        revenue,
        cost,
        profit,
        margin: row.has_unknown_cost ? null : margin(profit, revenue),
        hasUnknownCost: row.has_unknown_cost,
      };
    });
  }

  async reorderSuggestions(): Promise<ReorderRow[]> {
    const since = new Date(Date.now() - REORDER_WINDOW_DAYS * MS_PER_DAY);
    const rows = await this.reportsRepository.salesVelocity(since);
    return rows
      .map((row) => ({
        productId: row.product_id,
        productName: row.product_name,
        quantity: row.quantity_on_hand,
        reorderLevel: row.reorder_level,
        ...reorderSuggestion({
          unitsSoldLast30Days: Number(row.units_sold_recently),
          quantity: row.quantity_on_hand,
          reorderLevel: row.reorder_level,
        }),
      }))
      .sort((a, b) => {
        if (a.daysLeft === null && b.daysLeft === null) return a.productName.localeCompare(b.productName);
        if (a.daysLeft === null) return 1;
        if (b.daysLeft === null) return -1;
        return a.daysLeft - b.daysLeft;
      });
  }

  /** The caller's own numbers. Deliberately no cost or profit. */
  async mySales(userId: number, range: DateRange) {
    const [currentRow, previousRow, recent] = await Promise.all([
      this.reportsRepository.totals(range, userId),
      this.reportsRepository.totals(previousRange(range), userId),
      this.reportsRepository.recentSalesBy(userId, range, MY_RECENT_SALES_LIMIT),
    ]);
    const pick = (row: TotalsRow) => ({
      salesCount: Number(row.sales_count),
      unitsSold: Number(row.units_sold),
      revenue: Number(row.revenue),
    });
    return {
      current: pick(currentRow),
      previous: pick(previousRow),
      recentSales: recent.map((sale) => ({
        id: sale.id,
        productName: sale.product_name,
        quantity: sale.quantity_sold,
        totalAmount: Number(sale.total_amount),
        saleDate: sale.sale_date.toISOString(),
      })),
    };
  }
}
```

- [ ] **Step 7: Write the controller and routes**

Create `backend/src/controllers/reportsController.ts`:

```ts
import type { Request, Response } from 'express';
import type { ReportsService } from '../services/ReportsService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { profitQuerySchema, reportRangeSchema } from '../validators/reportValidators.js';
import { parseInput } from '../validators/validate.js';

export function createReportsController(reportsService: ReportsService) {
  return {
    async summary(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await reportsService.summary(parseInput(reportRangeSchema, req.query)));
    },

    async team(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await reportsService.team(parseInput(reportRangeSchema, req.query)));
    },

    async profit(req: Request, res: Response): Promise<void> {
      const range = parseInput(reportRangeSchema, req.query);
      const { groupBy } = parseInput(profitQuerySchema, req.query);
      sendSuccess(res, await reportsService.profit(range, groupBy));
    },

    async reorderSuggestions(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await reportsService.reorderSuggestions());
    },

    async mySales(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await reportsService.mySales(req.user!.id, parseInput(reportRangeSchema, req.query)));
    },
  };
}
```

Create `backend/src/routes/reportsRoutes.ts`:

```ts
import { Router } from 'express';
import type { Container } from '../container.js';
import { createReportsController } from '../controllers/reportsController.js';

export function createReportsRoutes({ reportsService, guards }: Container): Router {
  const controller = createReportsController(reportsService);
  const router = Router();

  router.get('/summary', ...guards.admin, controller.summary);
  router.get('/team', ...guards.admin, controller.team);
  router.get('/profit', ...guards.admin, controller.profit);
  router.get('/reorder-suggestions', ...guards.admin, controller.reorderSuggestions);
  // Employees see their own numbers; family members don't sell.
  router.get('/my-sales', ...guards.staff, controller.mySales);

  return router;
}
```

- [ ] **Step 8: Wire it up**

`backend/src/container.ts`: create `const reportsRepository = new ReportsRepository(db);` and `const reportsService = new ReportsService(reportsRepository);` and return both.

`backend/src/routes/index.ts`: `router.use('/reports', createReportsRoutes(container));`.

- [ ] **Step 9: Run tests**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add backend
git commit -m "feat: Add profit, team and reorder reports to the API" -m "For any period up to a year: revenue, profit, margin and units compared with the period before; each team member's sales and profit (including people who have since left); profit per product or category, with products missing a cost price flagged; and for every product, how many days of stock are left and how many to reorder. Employees get their own sales totals, without profit or anyone else's numbers." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: CSV exports

**Files:**
- Create: `backend/src/services/ExportService.ts`
- Create: `backend/src/controllers/exportsController.ts`
- Create: `backend/src/routes/exportsRoutes.ts`
- Modify: `backend/src/app.ts` (CORS exposes `Content-Disposition`)
- Modify: `backend/src/container.ts`, `backend/src/routes/index.ts`
- Test: `backend/tests/exports.test.ts` (new)

**Interfaces:**
- Consumes: `toCsv`, `CsvColumn` (Task 5); `ReportsRepository.salesForExport`, `ReportsRepository.salesVelocity`, `ReportsService.team`, `ReportsService.reorderSuggestions` (Task 6).
- Produces: `GET /api/exports/sales.csv`, `GET /api/exports/stock.csv`, `GET /api/exports/team.csv` (admin), each with a `Content-Disposition` filename.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/exports.test.ts`:

```ts
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestCategory, loginAs, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;
let adminToken: string;
let categoryId: number;

beforeAll(async () => {
  context = await setupTestApp();
});
beforeEach(async () => {
  await resetData(context.db);
  adminToken = await loginAs(context, 'admin');
  categoryId = (await createTestCategory(context.db)).id;
});
afterAll(() => context.db.destroy());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createAndSell(name: string, quantity: number) {
  const created = await request(context.app)
    .post('/api/products')
    .set(auth(adminToken))
    .send({ name, categoryId, price: 100, costPrice: 60, stock: 50, sku: `SKU-${quantity}` });
  await request(context.app)
    .post('/api/sales')
    .set(auth(adminToken))
    .send({ productId: created.body.data.id, quantity, saleDate: '2026-03-10T12:00:00Z' });
}

const download = (path: string) => request(context.app).get(path).set(auth(adminToken)).buffer(true);

describe('CSV exports', () => {
  it('should export sales with a BOM, headers and a dated filename', async () => {
    await createAndSell('Oak Chair', 2);

    const response = await download('/api/exports/sales.csv?startDate=2026-03-01&endDate=2026-03-31');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toBe('attachment; filename="4vd-sales-2026-03-01-to-2026-03-31.csv"');
    expect(response.text.startsWith('﻿Date,Product,SKU,Quantity,Unit price,Total,Unit cost,Profit,Sold by,Notes\r\n')).toBe(true);
    expect(response.text).toContain(',Oak Chair,SKU-2,2,100,200,60,80,Test admin,');
  });

  it('should keep a product name with commas, quotes and line breaks in one cell', async () => {
    await createAndSell('Chair, "oak"\nlarge', 1);

    const response = await download('/api/exports/sales.csv?startDate=2026-03-01&endDate=2026-03-31');

    expect(response.text).toContain(',"Chair, ""oak""\nlarge",SKU-1,1,');
  });

  it('should defuse names that start like a formula', async () => {
    await createAndSell('=HYPERLINK("http://evil")', 1);

    const response = await download('/api/exports/sales.csv?startDate=2026-03-01&endDate=2026-03-31');

    expect(response.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it('should export stock with value and days left', async () => {
    await createAndSell('Oak Chair', 2);

    const response = await download('/api/exports/stock.csv');

    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="4vd-stock-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(response.text).toContain('Product,SKU,Category,In stock,Reorder level,Price,Cost,Stock value,Days left');
    expect(response.text).toContain('Oak Chair,SKU-2,Furniture,48,10,100,60,2880,');
  });

  it('should export the team report', async () => {
    await createAndSell('Oak Chair', 2);

    const response = await download('/api/exports/team.csv?startDate=2026-03-01&endDate=2026-03-31');

    expect(response.text).toContain('Name,Role,Sales,Units sold,Revenue,Profit,Average sale');
    expect(response.text).toContain('Test admin,admin,1,2,200,80,200');
  });

  it('should be admin only and return JSON errors', async () => {
    const employeeToken = await loginAs(context, 'employee');

    const forbidden = await request(context.app).get('/api/exports/stock.csv').set(auth(employeeToken));
    const invalid = await download('/api/exports/sales.csv');

    expect(forbidden.status).toBe(403);
    expect(invalid.status).toBe(400);
    expect(invalid.body.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run tests/exports.test.ts`
Expected: FAIL (404s).

- [ ] **Step 3: Write the export service**

Create `backend/src/services/ExportService.ts`:

```ts
import type { ReportsRepository, SaleExportRow, VelocityRow } from '../repositories/ReportsRepository.js';
import { type CsvColumn, toCsv } from '../utils/csv.js';
import { roundMoney } from '../utils/money.js';
import type { DateRange } from './reports/calculations.js';
import type { ReorderRow, ReportsService, TeamRow } from './ReportsService.js';

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** The last day included in an end-exclusive range, for filenames. */
const lastIncludedDay = (range: DateRange) => isoDay(new Date(range.endDate.getTime() - 1));

const SALES_COLUMNS: CsvColumn<SaleExportRow>[] = [
  { header: 'Date', value: (row) => row.sale_date.toISOString() },
  { header: 'Product', value: (row) => row.product_name },
  { header: 'SKU', value: (row) => row.sku },
  { header: 'Quantity', value: (row) => row.quantity_sold },
  { header: 'Unit price', value: (row) => Number(row.price_per_unit) },
  { header: 'Total', value: (row) => Number(row.total_amount) },
  { header: 'Unit cost', value: (row) => (row.unit_cost === null ? null : Number(row.unit_cost)) },
  {
    header: 'Profit',
    value: (row) =>
      row.unit_cost === null ? null : roundMoney(row.quantity_sold * (Number(row.price_per_unit) - Number(row.unit_cost))),
  },
  { header: 'Sold by', value: (row) => row.sold_by_name },
  { header: 'Notes', value: (row) => row.notes },
];

type StockExportRow = VelocityRow & { daysLeft: number | null };

const STOCK_COLUMNS: CsvColumn<StockExportRow>[] = [
  { header: 'Product', value: (row) => row.product_name },
  { header: 'SKU', value: (row) => row.sku },
  { header: 'Category', value: (row) => row.category_name },
  { header: 'In stock', value: (row) => row.quantity_on_hand },
  { header: 'Reorder level', value: (row) => row.reorder_level },
  { header: 'Price', value: (row) => Number(row.base_price) },
  { header: 'Cost', value: (row) => (row.cost_price === null ? null : Number(row.cost_price)) },
  // Valued at cost, falling back to the sale price when cost is unknown (same as the dashboard).
  { header: 'Stock value', value: (row) => roundMoney(row.quantity_on_hand * Number(row.cost_price ?? row.base_price)) },
  { header: 'Days left', value: (row) => row.daysLeft },
];

const TEAM_COLUMNS: CsvColumn<TeamRow>[] = [
  { header: 'Name', value: (row) => row.name },
  { header: 'Role', value: (row) => row.role },
  { header: 'Sales', value: (row) => row.salesCount },
  { header: 'Units sold', value: (row) => row.unitsSold },
  { header: 'Revenue', value: (row) => row.revenue },
  { header: 'Profit', value: (row) => row.profit },
  { header: 'Average sale', value: (row) => row.averageSale },
];

export interface CsvFile {
  filename: string;
  content: string;
}

export class ExportService {
  constructor(
    private readonly reportsRepository: ReportsRepository,
    private readonly reportsService: ReportsService,
  ) {}

  async sales(range: DateRange): Promise<CsvFile> {
    const rows = await this.reportsRepository.salesForExport(range);
    return {
      filename: `4vd-sales-${isoDay(range.startDate)}-to-${lastIncludedDay(range)}.csv`,
      content: toCsv(SALES_COLUMNS, rows),
    };
  }

  async stock(): Promise<CsvFile> {
    const [products, suggestions] = await Promise.all([
      this.reportsRepository.salesVelocity(new Date(0)),
      this.reportsService.reorderSuggestions(),
    ]);
    const daysLeftById = new Map(suggestions.map((row: ReorderRow) => [row.productId, row.daysLeft]));
    const rows = products.map((product) => ({ ...product, daysLeft: daysLeftById.get(product.product_id) ?? null }));
    return { filename: `4vd-stock-${isoDay(new Date())}.csv`, content: toCsv(STOCK_COLUMNS, rows) };
  }

  async team(range: DateRange): Promise<CsvFile> {
    const rows = await this.reportsService.team(range);
    return {
      filename: `4vd-team-${isoDay(range.startDate)}-to-${lastIncludedDay(range)}.csv`,
      content: toCsv(TEAM_COLUMNS, rows),
    };
  }
}
```

- [ ] **Step 4: Write the controller and routes**

Create `backend/src/controllers/exportsController.ts`:

```ts
import type { Request, Response } from 'express';
import type { CsvFile, ExportService } from '../services/ExportService.js';
import { reportRangeSchema } from '../validators/reportValidators.js';
import { parseInput } from '../validators/validate.js';

function sendCsv(res: Response, file: CsvFile): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.send(file.content);
}

export function createExportsController(exportService: ExportService) {
  return {
    async sales(req: Request, res: Response): Promise<void> {
      sendCsv(res, await exportService.sales(parseInput(reportRangeSchema, req.query)));
    },

    async stock(_req: Request, res: Response): Promise<void> {
      sendCsv(res, await exportService.stock());
    },

    async team(req: Request, res: Response): Promise<void> {
      sendCsv(res, await exportService.team(parseInput(reportRangeSchema, req.query)));
    },
  };
}
```

Create `backend/src/routes/exportsRoutes.ts`:

```ts
import { Router } from 'express';
import type { Container } from '../container.js';
import { createExportsController } from '../controllers/exportsController.js';

export function createExportsRoutes({ exportService, guards }: Container): Router {
  const controller = createExportsController(exportService);
  const router = Router();

  router.use(...guards.admin);
  router.get('/sales.csv', controller.sales);
  router.get('/stock.csv', controller.stock);
  router.get('/team.csv', controller.team);

  return router;
}
```

- [ ] **Step 5: Wire it up and expose the filename to the browser**

`backend/src/container.ts`: `const exportService = new ExportService(reportsRepository, reportsService);` and return it.

`backend/src/routes/index.ts`: `router.use('/exports', createExportsRoutes(container));`.

`backend/src/app.ts`: browsers hide `Content-Disposition` from cross-origin JavaScript unless it's exposed:

```ts
  app.use(cors({ origin: config.corsOrigins, exposedHeaders: ['Content-Disposition'] }));
```

- [ ] **Step 6: Run tests**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat: Export sales, stock and the team report to CSV" -m "Admins can download sales for any period (with cost and profit per sale), the current stock with its value and days left, and the team report, all as CSV files that open straight in Excel with euro signs intact. Product names that look like spreadsheet formulas are defused." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Admin Reports page

**Files:**
- Modify: `admin/src/services/apiClient.ts` (shared send-with-refresh, `apiDownload`)
- Modify: `admin/src/services/api.ts` (`reportsApi`, `exportsApi`)
- Modify: `admin/src/services/types.ts` (report types)
- Create: `admin/src/utils/periods.ts`
- Create: `admin/src/components/PeriodPicker.tsx`
- Create: `admin/src/pages/ReportsPage.tsx`
- Modify: `admin/src/App.tsx`, `admin/src/components/Layout.tsx`, `admin/src/index.css`

**Interfaces:**
- Consumes: `/api/reports/summary|team|profit`, `/api/exports/*.csv` (Tasks 6–7).
- Produces: `type PeriodKey = 'this-month' | 'last-month' | 'last-30-days' | 'this-year' | 'custom'`; `resolvePeriod(key, custom?: { from: string; to: string }, now?: Date): { startDate: string; endDate: string; label: string }`; `<PeriodPicker />`; `apiDownload(path, query): Promise<{ blob: Blob; filename: string | null }>`; `saveDownload(blob, filename)`; `reportsApi.reorderSuggestions()` (used by Task 9).

- [ ] **Step 1: Add report types**

Append to `admin/src/services/types.ts`:

```ts
export interface PeriodTotals {
  revenue: number;
  revenueWithoutCost: number;
  cost: number;
  profit: number;
  margin: number | null;
  unitsSold: number;
  salesCount: number;
}

export interface ReportSummary {
  current: PeriodTotals;
  previous: PeriodTotals;
  change: { revenue: number | null; profit: number | null; unitsSold: number | null; salesCount: number | null };
}

export interface TeamRow {
  userId: number;
  name: string;
  role: UserRole;
  salesCount: number;
  unitsSold: number;
  revenue: number;
  profit: number;
  averageSale: number;
}

export interface ProfitRow {
  id: number;
  name: string;
  unitsSold: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number | null;
  hasUnknownCost: boolean;
}

export interface ReorderSuggestion {
  productId: number;
  productName: string;
  quantity: number;
  reorderLevel: number;
  averageDailySales: number;
  daysLeft: number | null;
  suggestedOrder: number;
}
```

- [ ] **Step 2: Share the refresh logic and add downloads**

In `admin/src/services/apiClient.ts`, replace `apiRequest` with a shared helper plus two callers:

```ts
/** Send a request, refreshing the session once if the access token expired. */
async function sendWithRefresh(path: string, options: RequestOptions): Promise<Response> {
  let response = await send(path, options);
  if (response.status === 401 && tokenStore.refresh && !path.startsWith('/auth/')) {
    if (await refreshSession()) {
      response = await send(path, options);
    } else {
      tokenStore.clear();
      onSessionExpired();
    }
  }
  return response;
}

async function toApiError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as ApiResponse<unknown> | null;
  return new ApiError(
    body?.message ?? `The server answered with status ${response.status}`,
    response.status,
    body?.error ?? null,
  );
}

export async function apiRequest<TData>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: TData; meta?: PaginationMeta }> {
  const response = await sendWithRefresh(path, options);
  const body = (await response.clone().json().catch(() => null)) as ApiResponse<TData> | null;
  if (!response.ok || !body?.success) throw await toApiError(response);
  return { data: body.data, meta: body.meta };
}

/** Fetch a file (e.g. a CSV export) through the authenticated API. */
export async function apiDownload(
  path: string,
  query: RequestOptions['query'] = {},
): Promise<{ blob: Blob; filename: string | null }> {
  const response = await sendWithRefresh(path, { query });
  if (!response.ok) throw await toApiError(response);
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? null;
  return { blob: await response.blob(), filename };
}

/** Hand a downloaded file to the browser to save. */
export function saveDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 3: Add the API functions**

Append to `admin/src/services/api.ts` (add `ProfitRow, ReorderSuggestion, ReportSummary, TeamRow` to the type import and `apiDownload, saveDownload` to the `./apiClient` import):

```ts
export interface ReportRange {
  startDate: string;
  endDate: string;
}

export const reportsApi = {
  summary: async (range: ReportRange) => (await apiRequest<ReportSummary>('/reports/summary', { query: { ...range } })).data,
  team: async (range: ReportRange) => (await apiRequest<TeamRow[]>('/reports/team', { query: { ...range } })).data,
  profit: async (range: ReportRange, groupBy: 'product' | 'category') =>
    (await apiRequest<ProfitRow[]>('/reports/profit', { query: { ...range, groupBy } })).data,
  reorderSuggestions: async () => (await apiRequest<ReorderSuggestion[]>('/reports/reorder-suggestions')).data,
};

export const exportsApi = {
  async download(kind: 'sales' | 'stock' | 'team', range?: ReportRange): Promise<void> {
    const { blob, filename } = await apiDownload(`/exports/${kind}.csv`, range ? { ...range } : {});
    saveDownload(blob, filename ?? `4vd-${kind}.csv`);
  },
};
```

- [ ] **Step 4: Add period presets**

Create `admin/src/utils/periods.ts`:

```ts
export type PeriodKey = 'this-month' | 'last-month' | 'last-30-days' | 'this-year' | 'custom';

export const PERIOD_OPTIONS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'last-30-days', label: 'Last 30 days' },
  { key: 'this-year', label: 'This year' },
  { key: 'custom', label: 'Custom dates' },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const dayLabel = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** "2026-03-05" read as local midnight (new Date("2026-03-05") would be UTC). */
function localDay(isoDay: string): Date {
  const [year, month, day] = isoDay.split('-').map(Number);
  return new Date(year!, month! - 1, day!);
}

/**
 * Turn a preset into exact instants in the browser's own timezone, so
 * "this month" starts at local midnight on the 1st. End is exclusive.
 */
export function resolvePeriod(
  key: PeriodKey,
  custom?: { from: string; to: string },
  now: Date = new Date(),
): { startDate: string; endDate: string; label: string } {
  const year = now.getFullYear();
  const month = now.getMonth();

  if (key === 'custom' && custom?.from && custom.to) {
    const start = localDay(custom.from);
    const end = new Date(localDay(custom.to).getTime() + MS_PER_DAY);
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      label: `${dayLabel.format(start)} to ${dayLabel.format(localDay(custom.to))}`,
    };
  }

  let start: Date;
  let end: Date;
  let label: string;
  // "custom" without both dates picked yet shows this month.
  switch (key) {
    case 'last-month':
      start = new Date(year, month - 1, 1);
      end = new Date(year, month, 1);
      label = monthLabel.format(start);
      break;
    case 'last-30-days':
      end = now;
      start = new Date(now.getTime() - 30 * MS_PER_DAY);
      label = 'Last 30 days';
      break;
    case 'this-year':
      start = new Date(year, 0, 1);
      end = new Date(year + 1, 0, 1);
      label = String(year);
      break;
    default:
      start = new Date(year, month, 1);
      end = new Date(year, month + 1, 1);
      label = monthLabel.format(start);
  }
  return { startDate: start.toISOString(), endDate: end.toISOString(), label };
}
```

- [ ] **Step 5: Build the period picker**

Create `admin/src/components/PeriodPicker.tsx`:

```tsx
import { PERIOD_OPTIONS, type PeriodKey } from '../utils/periods';

interface PeriodPickerProps {
  period: PeriodKey;
  from: string;
  to: string;
  onChange: (next: { period: PeriodKey; from: string; to: string }) => void;
}

export function PeriodPicker({ period, from, to, onChange }: PeriodPickerProps) {
  return (
    <div className="toolbar">
      <select
        aria-label="Period"
        value={period}
        onChange={(event) => onChange({ period: event.target.value as PeriodKey, from, to })}
      >
        {PERIOD_OPTIONS.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
      {period === 'custom' && (
        <>
          <label className="inline-field">
            From
            <input type="date" value={from} max={to || undefined} onChange={(event) => onChange({ period, from: event.target.value, to })} />
          </label>
          <label className="inline-field">
            To
            <input type="date" value={to} min={from || undefined} onChange={(event) => onChange({ period, from, to: event.target.value })} />
          </label>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Build the Reports page**

Create `admin/src/pages/ReportsPage.tsx`:

```tsx
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { PeriodPicker } from '../components/PeriodPicker';
import { exportsApi, reportsApi } from '../services/api';
import type { ReportSummary } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatMoney } from '../utils/format';
import { type PeriodKey, resolvePeriod } from '../utils/periods';

const percent = new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 1 });

function describeChange(change: number | null): string {
  if (change === null) return 'nothing to compare with';
  if (change === 0) return 'same as the period before';
  return `${change > 0 ? 'up' : 'down'} ${percent.format(Math.abs(change))} on the period before`;
}

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const period = (params.get('period') as PeriodKey | null) ?? 'this-month';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const range = resolvePeriod(period, { from, to });
  const rangeKey = { startDate: range.startDate, endDate: range.endDate };

  const summary = useQuery({
    queryKey: ['reports', 'summary', rangeKey],
    queryFn: () => reportsApi.summary(rangeKey),
    placeholderData: keepPreviousData,
  });

  function changePeriod(next: { period: PeriodKey; from: string; to: string }) {
    const nextParams = new URLSearchParams();
    nextParams.set('period', next.period);
    if (next.period === 'custom') {
      if (next.from) nextParams.set('from', next.from);
      if (next.to) nextParams.set('to', next.to);
    }
    setParams(nextParams, { replace: true });
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Reports</h1>
        <p className="page-intro">How much you sold and earned in {range.label}, and who sold it.</p>
      </header>

      <PeriodPicker period={period} from={from} to={to} onChange={changePeriod} />

      <section className="panel" aria-labelledby="summary-heading">
        <h2 id="summary-heading" className="panel__title">
          Money
        </h2>
        {summary.isPending && <Loading />}
        {summary.isError && <ErrorNotice error={summary.error} onRetry={() => summary.refetch()} />}
        {summary.data && <SummaryFigures summary={summary.data} />}
      </section>

      <TeamTable range={rangeKey} />
      <ProfitTable range={rangeKey} />
      <Exports range={rangeKey} />
    </>
  );
}

function SummaryFigures({ summary }: { summary: ReportSummary }) {
  const { current, change } = summary;
  return (
    <>
      <div className="summary">
        <div className="summary__hero">
          <span className="summary__hero-value">{formatMoney(current.revenue)}</span>
          <span className="summary__label">in sales, {describeChange(change.revenue)}</span>
        </div>
        <dl className="summary__figures">
          <div>
            <dt>Profit</dt>
            <dd>{formatMoney(current.profit)}</dd>
            <dd className="summary__change">{describeChange(change.profit)}</dd>
          </div>
          <div>
            <dt>Margin</dt>
            <dd>{current.margin === null ? 'Unknown' : percent.format(current.margin)}</dd>
          </div>
          <div>
            <dt>Units sold</dt>
            <dd>{current.unitsSold}</dd>
            <dd className="summary__change">{describeChange(change.unitsSold)}</dd>
          </div>
        </dl>
      </div>
      {current.revenueWithoutCost > 0 && (
        <p className="field-hint">
          {formatMoney(current.revenueWithoutCost)} of sales came from products without a cost price, so they're left out of
          profit and margin. Add cost prices on the Products page to include them.
        </p>
      )}
    </>
  );
}

function TeamTable({ range }: { range: { startDate: string; endDate: string } }) {
  const team = useQuery({
    queryKey: ['reports', 'team', range],
    queryFn: () => reportsApi.team(range),
    placeholderData: keepPreviousData,
  });

  return (
    <section className="panel" aria-labelledby="team-heading">
      <h2 id="team-heading" className="panel__title">
        Team
      </h2>
      {team.isPending && <Loading />}
      {team.isError && <ErrorNotice error={team.error} onRetry={() => team.refetch()} />}
      {team.data && team.data.length === 0 && <EmptyState title="No admins or employees yet" />}
      {team.data && team.data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col" className="table__numeric">Sales</th>
                <th scope="col" className="table__numeric">Units</th>
                <th scope="col" className="table__numeric">Revenue</th>
                <th scope="col" className="table__numeric">Profit</th>
                <th scope="col" className="table__numeric">Average sale</th>
              </tr>
            </thead>
            <tbody>
              {team.data.map((person) => (
                <tr key={person.userId} className={person.salesCount === 0 ? 'table__row--muted' : undefined}>
                  <td>
                    <span className="table__primary-link">{person.name}</span>
                    <span className="table__secondary">{person.role === 'admin' ? 'Admin' : 'Employee'}</span>
                  </td>
                  <td className="table__numeric">{person.salesCount}</td>
                  <td className="table__numeric">{person.unitsSold}</td>
                  <td className="table__numeric">{formatMoney(person.revenue)}</td>
                  <td className="table__numeric">{formatMoney(person.profit)}</td>
                  <td className="table__numeric">{person.salesCount === 0 ? '–' : formatMoney(person.averageSale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ProfitTable({ range }: { range: { startDate: string; endDate: string } }) {
  const [groupBy, setGroupBy] = useState<'product' | 'category'>('product');
  const profit = useQuery({
    queryKey: ['reports', 'profit', range, groupBy],
    queryFn: () => reportsApi.profit(range, groupBy),
    placeholderData: keepPreviousData,
  });

  return (
    <section className="panel" aria-labelledby="profit-heading">
      <div className="panel__header">
        <h2 id="profit-heading" className="panel__title">
          Profit by {groupBy}
        </h2>
        <div className="segmented" role="radiogroup" aria-label="Group profit by">
          {(['product', 'category'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={groupBy === option}
              className="segmented__option"
              onClick={() => setGroupBy(option)}
            >
              {option === 'product' ? 'Products' : 'Categories'}
            </button>
          ))}
        </div>
      </div>
      {profit.isPending && <Loading />}
      {profit.isError && <ErrorNotice error={profit.error} onRetry={() => profit.refetch()} />}
      {profit.data && profit.data.length === 0 && <EmptyState title="No sales in this period" />}
      {profit.data && profit.data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{groupBy === 'product' ? 'Product' : 'Category'}</th>
                <th scope="col" className="table__numeric">Units</th>
                <th scope="col" className="table__numeric">Revenue</th>
                <th scope="col" className="table__numeric">Cost</th>
                <th scope="col" className="table__numeric">Profit</th>
                <th scope="col" className="table__numeric">Margin</th>
              </tr>
            </thead>
            <tbody>
              {profit.data.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.name}
                    {row.hasUnknownCost && <span className="table__secondary">Some sales have no cost price</span>}
                  </td>
                  <td className="table__numeric">{row.unitsSold}</td>
                  <td className="table__numeric">{formatMoney(row.revenue)}</td>
                  <td className="table__numeric">{formatMoney(row.cost)}</td>
                  <td className="table__numeric">{formatMoney(row.profit)}</td>
                  <td className="table__numeric">{row.margin === null ? 'Unknown' : percent.format(row.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Exports({ range }: { range: { startDate: string; endDate: string } }) {
  const download = useMutation({
    mutationFn: (kind: 'sales' | 'stock' | 'team') => exportsApi.download(kind, kind === 'stock' ? undefined : range),
  });

  return (
    <section className="panel" aria-labelledby="exports-heading">
      <h2 id="exports-heading" className="panel__title">
        Download for Excel
      </h2>
      <div className="form-actions">
        <button type="button" className="button button--quiet" onClick={() => download.mutate('sales')} disabled={download.isPending}>
          Sales in this period
        </button>
        <button type="button" className="button button--quiet" onClick={() => download.mutate('team')} disabled={download.isPending}>
          Team report
        </button>
        <button type="button" className="button button--quiet" onClick={() => download.mutate('stock')} disabled={download.isPending}>
          Current stock
        </button>
      </div>
      {download.isError && (
        <p className="form-error" role="alert">
          {errorMessage(download.error)}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 7: Add the route, nav item and one style**

`admin/src/App.tsx`: import `ReportsPage` and add `<Route path="reports" element={<ReportsPage />} />` after the sales route.

`admin/src/components/Layout.tsx`: insert `{ to: '/reports', label: 'Reports' },` after the Sales item in `NAV_ITEMS`.

Append to `admin/src/index.css` (before the reduced-motion block):

```css
.summary__change {
  color: var(--steel);
  font-size: 0.875rem;
  font-weight: 400;
}
```

- [ ] **Step 8: Build, lint and check in the browser**

Run: `cd admin && npm run build && npm run lint`
Expected: build succeeds, lint reports 0 warnings and 0 errors.

Then, with the backend running and the local database migrated, open http://localhost:5173/reports as the admin. Check: the figures show, the period picker changes them and the URL, the team and profit tables fill in, and each download button saves a `.csv` that opens in Excel.

- [ ] **Step 9: Commit**

```bash
git add admin
git commit -m "feat: Add a Reports page to the admin dashboard" -m "Pick a period (this month, last month, last 30 days, this year or your own dates) and see sales, profit, margin and units compared with the period before, each person's sales and profit, and profit per product or category. Buttons download sales, the team report and current stock for Excel." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Runway on the Stock page and the Activity page

**Files:**
- Modify: `admin/src/pages/InventoryPage.tsx`
- Modify: `admin/src/services/api.ts` (`activityApi`), `admin/src/services/types.ts` (`ActivityEntry`)
- Create: `admin/src/pages/ActivityPage.tsx`
- Modify: `admin/src/App.tsx`, `admin/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `reportsApi.reorderSuggestions()` (Task 8); `GET /api/activity` (Task 2); `usersApi.list` (existing).

- [ ] **Step 1: Add the activity types and API**

Append to `admin/src/services/types.ts`:

```ts
export interface ActivityEntry {
  id: number;
  action: string;
  entityType: string | null;
  entityId: number | null;
  summary: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  user: { id: number; name: string } | null;
}
```

Append to `admin/src/services/api.ts` (add `ActivityEntry` to the type import):

```ts
export const activityApi = {
  list: (query: { page: number; userId?: number; action?: string }) =>
    paginated<ActivityEntry>('/activity', { limit: 30, ...query }),
};
```

- [ ] **Step 2: Show runway on the Stock page**

In `admin/src/pages/InventoryPage.tsx`:

Add imports: `reportsApi` from `../services/api` and `import type { ReorderSuggestion } from '../services/types';`.

Inside `InventoryPage`, after the `query` declaration:

```tsx
  const suggestions = useQuery({ queryKey: ['reports', 'reorder'], queryFn: reportsApi.reorderSuggestions });
  const suggestionById = new Map<number, ReorderSuggestion>(
    (suggestions.data ?? []).map((suggestion) => [suggestion.productId, suggestion]),
  );
```

Add a helper at the bottom of the file:

```tsx
function describeRunway(suggestion: ReorderSuggestion | undefined): string {
  if (!suggestion) return '–';
  if (suggestion.daysLeft === null) return 'No recent sales';
  if (suggestion.daysLeft === 0) return 'Today';
  return `About ${suggestion.daysLeft} ${suggestion.daysLeft === 1 ? 'day' : 'days'}`;
}
```

In the table header, replace the "Last restocked" `<th>` with these three:

```tsx
                  <th scope="col">Runs out in</th>
                  <th scope="col" className="table__numeric">
                    Reorder
                  </th>
                  <th scope="col">Last restocked</th>
```

and in each row, before the last-restocked `<td>`:

```tsx
                    <td>{describeRunway(suggestionById.get(item.productId))}</td>
                    <td className="table__numeric">{suggestionById.get(item.productId)?.suggestedOrder || '–'}</td>
```

Change the page intro to: `Emptiest first. "Runs out in" is based on the last 30 days of sales.`

- [ ] **Step 3: Build the Activity page**

Create `admin/src/pages/ActivityPage.tsx`:

```tsx
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { activityApi, usersApi } from '../services/api';
import { formatDateTime } from '../utils/format';

/** Kinds of change a person would filter by, mapped to action prefixes. */
const KINDS = [
  { value: '', label: 'Everything' },
  { value: 'product,pricing,category', label: 'Products and prices' },
  { value: 'stock', label: 'Stock' },
  { value: 'sale', label: 'Sales' },
  { value: 'user', label: 'People' },
  { value: 'auth', label: 'Logins' },
];

export function ActivityPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const userId = params.get('userId') ? Number(params.get('userId')) : undefined;
  const action = params.get('kind') ?? '';

  const people = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list(1) });
  const activity = useQuery({
    queryKey: ['activity', { page, userId, action }],
    queryFn: () => activityApi.list({ page, userId, action: action || undefined }),
    placeholderData: keepPreviousData,
  });

  function updateParams(changes: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Activity</h1>
        <p className="page-intro">Who changed what, newest first.</p>
      </header>

      <div className="toolbar">
        <select aria-label="Person" value={userId ?? ''} onChange={(event) => updateParams({ userId: event.target.value })}>
          <option value="">Everyone</option>
          {people.data?.items.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
        <select aria-label="Kind of change" value={action} onChange={(event) => updateParams({ kind: event.target.value })}>
          {KINDS.map((kind) => (
            <option key={kind.label} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </select>
      </div>

      {activity.isPending && <Loading />}
      {activity.isError && <ErrorNotice error={activity.error} onRetry={() => activity.refetch()} />}
      {activity.data && activity.data.items.length === 0 && (
        <EmptyState title="Nothing here yet">Changes show up here as people use the app.</EmptyState>
      )}
      {activity.data && activity.data.items.length > 0 && (
        <>
          <ul className="category-list">
            {activity.data.items.map((entry) => (
              <li key={entry.id} className="category-list__row activity-row">
                <div>
                  <p className="category-list__name">{entry.summary}</p>
                  <p className="category-list__description">{entry.user?.name ?? 'The system'}</p>
                </div>
                <span className="category-list__count">{formatDateTime(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
          <Pagination meta={activity.data.meta} itemLabel="changes" onPageChange={(next) => updateParams({ page: String(next) })} />
        </>
      )}
    </>
  );
}
```

Append to `admin/src/index.css` (before the reduced-motion block):

```css
.activity-row {
  grid-template-columns: 1fr auto;
}
```

- [ ] **Step 4: Add the route and nav item**

`admin/src/App.tsx`: import `ActivityPage` and add `<Route path="activity" element={<ActivityPage />} />`.

`admin/src/components/Layout.tsx`: append `{ to: '/activity', label: 'Activity' },` as the last item of `NAV_ITEMS` (after People).

- [ ] **Step 5: Build, lint and check in the browser**

Run: `cd admin && npm run build && npm run lint`
Expected: success, 0 warnings.

In the browser: the Stock page shows "Runs out in" and "Reorder" for the demo products. The Activity page lists your login and any changes you make, and both filters narrow the list.

- [ ] **Step 6: Commit**

```bash
git add admin
git commit -m "feat: Show when stock runs out, and add an Activity page" -m "The Stock page now says roughly how many days each product has left at the current pace of sales, and how many to reorder. The new Activity page lists who changed what (products, prices, stock, sales, people and logins), filtered by person or kind of change." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: "My sales" in the mobile app

**Files:**
- Modify: `mobile/src/services/api.ts` (`reportsApi.mySales`)
- Modify: `mobile/src/services/types.ts` (`MySales`)
- Create: `mobile/src/components/MySales.tsx`
- Modify: `mobile/src/screens/AccountScreen.tsx`

**Interfaces:**
- Consumes: `GET /api/reports/my-sales?startDate&endDate` (Task 6); `canRecordSales(user)` (existing).

- [ ] **Step 1: Add the type and API call**

Append to `mobile/src/services/types.ts`:

```ts
export interface SalesTotals {
  salesCount: number;
  unitsSold: number;
  revenue: number;
}

export interface MySales {
  current: SalesTotals;
  previous: SalesTotals;
  recentSales: Array<{ id: number; productName: string; quantity: number; totalAmount: number; saleDate: string }>;
}
```

Append to `mobile/src/services/api.ts` (add `MySales` to the type import):

```ts
export const reportsApi = {
  mySales: async (startDate: string, endDate: string) =>
    (await apiRequest<MySales>('/reports/my-sales', { query: { startDate, endDate } })).data,
};
```

- [ ] **Step 2: Build the component**

Create `mobile/src/components/MySales.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { reportsApi } from '../services/api';
import { fonts, radius, spacing, useThemeColors } from '../theme';
import { errorMessage, formatMoney } from '../utils/format';

const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long' });
const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/** This calendar month in the phone's own timezone; the API compares it with last month. */
function thisMonth(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { startDate: start.toISOString(), endDate: end.toISOString(), name: monthName.format(start) };
}

export const MY_SALES_QUERY_KEY = ['reports', 'my-sales'];

export function MySales() {
  const colors = useThemeColors();
  const month = thisMonth();
  const mySales = useQuery({
    queryKey: [...MY_SALES_QUERY_KEY, month.startDate],
    queryFn: () => reportsApi.mySales(month.startDate, month.endDate),
  });

  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <Text style={[styles.title, { color: colors.ink }]}>My sales in {month.name}</Text>
      {mySales.isPending && <Text style={[styles.muted, { color: colors.steel }]}>Loading…</Text>}
      {mySales.isError && <Text style={[styles.muted, { color: colors.signalOut }]}>{errorMessage(mySales.error)}</Text>}
      {mySales.data && (
        <>
          <Text style={[styles.hero, { color: colors.ink }]}>{formatMoney(mySales.data.current.revenue)}</Text>
          <Text style={[styles.muted, { color: colors.steel }]}>
            {mySales.data.current.salesCount} {mySales.data.current.salesCount === 1 ? 'sale' : 'sales'},{' '}
            {mySales.data.current.unitsSold} units. Last month: {formatMoney(mySales.data.previous.revenue)}
          </Text>
          {mySales.data.recentSales.length > 0 ? (
            <View style={styles.list}>
              {mySales.data.recentSales.map((sale) => (
                <View key={sale.id} style={[styles.row, { borderTopColor: colors.line }]}>
                  <Text style={[styles.rowText, { color: colors.ink }]} numberOfLines={1}>
                    {sale.quantity} × {sale.productName}
                  </Text>
                  <Text style={[styles.rowAmount, { color: colors.ink }]}>{formatMoney(sale.totalAmount)}</Text>
                  <Text style={[styles.rowDate, { color: colors.steel }]}>{shortDate.format(new Date(sale.saleDate))}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.muted, { color: colors.steel }]}>No sales yet this month.</Text>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: spacing.lg, borderRadius: radius.panel, borderWidth: 1, gap: spacing.xs },
  title: { fontFamily: fonts.display, fontSize: 20 },
  hero: { fontFamily: fonts.bodyBold, fontSize: 36, marginTop: spacing.xs },
  muted: { fontFamily: fonts.body, fontSize: 15 },
  list: { marginTop: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: 1 },
  rowText: { flex: 1, fontFamily: fonts.body, fontSize: 15 },
  rowAmount: { fontFamily: fonts.bodyBold, fontSize: 15, fontVariant: ['tabular-nums'] },
  rowDate: { fontFamily: fonts.body, fontSize: 13, minWidth: 48, textAlign: 'right' },
});
```

- [ ] **Step 3: Show it on the Account tab with pull to refresh**

Replace `mobile/src/screens/AccountScreen.tsx` with:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MY_SALES_QUERY_KEY, MySales } from '../components/MySales';
import { Button } from '../components/ui';
import { API_URL } from '../services/apiClient';
import { canRecordSales, useAuth, useCurrentUser } from '../state/useAuth';
import { fonts, radius, spacing, useThemeColors } from '../theme';

const ROLE_DESCRIPTION = {
  admin: 'Admin. Manage everything from the admin dashboard.',
  employee: 'Employee. You can browse products and record sales.',
  family: 'Family. You can browse products and save favorites.',
} as const;

export function AccountScreen() {
  const colors = useThemeColors();
  const user = useCurrentUser();
  const { logout } = useAuth();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const showSales = canRecordSales(user);

  async function refresh() {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: MY_SALES_QUERY_KEY });
    setIsRefreshing(false);
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      refreshControl={showSales ? <RefreshControl refreshing={isRefreshing} onRefresh={refresh} /> : undefined}
    >
      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text style={[styles.name, { color: colors.ink }]}>{user.name}</Text>
        <Text style={[styles.detail, { color: colors.steel }]}>{user.email}</Text>
        <Text style={[styles.detail, { color: colors.ink }]}>{ROLE_DESCRIPTION[user.role]}</Text>
      </View>
      {showSales && <MySales />}
      <Button label="Log out" variant="quiet" onPress={logout} />
      <Text style={[styles.footnote, { color: colors.steel }]}>Connected to {API_URL}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  panel: { padding: spacing.lg, borderRadius: radius.panel, borderWidth: 1, gap: spacing.xs },
  name: { fontFamily: fonts.displayBold, fontSize: 28 },
  detail: { fontFamily: fonts.body, fontSize: 16 },
  footnote: { fontFamily: fonts.body, fontSize: 13, textAlign: 'center' },
});
```

In `mobile/src/screens/RecordSaleScreen.tsx`, inside `SaleForm`'s `onSuccess`, also refresh "My sales": add `queryClient.invalidateQueries({ queryKey: ['reports', 'my-sales'] });`.

- [ ] **Step 4: Typecheck and bundle**

Run: `cd mobile && npx tsc --noEmit && npx expo-doctor && CI=1 npx expo export --platform android --output-dir "$TEMP/expo-check"`
Expected: no type errors, 21/21 doctor checks, and an exported Android bundle. Delete `$TEMP/expo-check` afterwards.

- [ ] **Step 5: Commit**

```bash
git add mobile
git commit -m "feat: Show employees their own sales in the mobile app" -m "Employees and admins now see 'My sales' on the Account tab: what they've sold this month, how many units, last month's total for comparison, and their 10 most recent sales. Pull down to refresh. Family members don't see it, and nobody sees profit or other people's numbers here." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Document the new endpoints and schema

**Files:**
- Modify: `docs/API.md`
- Modify: `docs/DATABASE.md`

- [ ] **Step 1: Add the endpoints to API.md**

Insert before the `## Notes` section of `docs/API.md`:

````markdown
## Reports

All report endpoints take `startDate` and `endDate` (required, ISO, end exclusive; a date-only `endDate` includes that whole day; at most 366 days). The comparison period is the same length immediately before.

Profit uses each sale's cost at the time of sale (`unit_cost`). Sales of products without a cost price are left out of cost, profit and margin; their revenue is reported as `revenueWithoutCost`.

| Method & path | Auth | Returns |
|---|---|---|
| `GET /reports/summary` | admin | `{ current, previous, change }`: totals for both periods and relative change (`0.12` = +12%, `null` when the previous value was 0) |
| `GET /reports/team` | admin | Per admin/employee, plus anyone who sold in the period: `{ userId, name, role, salesCount, unitsSold, revenue, profit, averageSale }` |
| `GET /reports/profit?groupBy=product\|category` | admin | `{ id, name, unitsSold, revenue, cost, profit, margin, hasUnknownCost }`, most profitable first |
| `GET /reports/reorder-suggestions` | admin | Per active product: `{ productId, productName, quantity, reorderLevel, averageDailySales, daysLeft, suggestedOrder }`, soonest to run out first. No date range |
| `GET /reports/my-sales` | admin, employee | The caller's own `current` and `previous` `{ salesCount, unitsSold, revenue }` and their 10 latest `recentSales`. Never cost or profit |

Totals shape: `{ revenue, revenueWithoutCost, cost, profit, margin, unitsSold, salesCount }`.

Reorder maths: `averageDailySales` = units sold in the last 30 days ÷ 30; `daysLeft` = stock ÷ that, rounded down (`null` without recent sales); `suggestedOrder` = `max(0, ceil(average × 30 + reorderLevel − stock))`.

## Exports (admin)

CSV files (UTF-8 with BOM, opens in Excel). Errors still come back as JSON.

| Method & path | Contents |
|---|---|
| `GET /exports/sales.csv?startDate&endDate` | One row per sale: date, product, SKU, quantity, unit price, total, unit cost, profit, sold by, notes |
| `GET /exports/stock.csv` | One row per active product: name, SKU, category, stock, reorder level, price, cost, stock value, days left |
| `GET /exports/team.csv?startDate&endDate` | The team report |

## Activity (admin)

`GET /activity?userId&entityType&entityId&action&page&limit`: newest first.

- `action`: comma-separated exact actions or prefixes, e.g. `stock`, `sale.recorded`, `product,pricing,category`
- `entityType`: `product`, `category`, `user` or `sale`

Entry: `{ id, action, entityType, entityId, summary, details, createdAt, user: { id, name } | null }`.

Logged actions: `auth.logged_in`, `product.created`, `product.updated`, `product.deleted`, `pricing.updated`, `stock.adjusted`, `sale.recorded`, `category.created`, `category.updated`, `category.deleted`, `user.created`, `user.updated`, `user.deleted`. Passwords are never logged.

````

- [ ] **Step 2: Record the migration in DATABASE.md**

In `docs/DATABASE.md`, add to the bullet list of differences under Overview:

```markdown
- **`sales.unit_cost`** (migration 002): the product's cost when it was sold, so profit doesn't change when a cost price is edited. Sales from before this migration were filled in from the cost price at the time of the migration
- **New `activity_log` table** (migration 002): `user_id`, `action`, `entity_type`, `entity_id`, `summary`, `details` (JSONB), `created_at`, indexed by time, user and entity
```

and add under **Schema versions**:

```markdown
- 002_reports_and_activity: `sales.unit_cost` and the `activity_log` table
```

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "docs: Document reports, exports and the activity log" -m "API.md covers the new report, export and activity endpoints, including how profit and reorder suggestions are worked out. DATABASE.md records the second migration." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
