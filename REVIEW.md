# REVIEW.md: reliability checklist

Before committing, check the items whose **trigger** matches your diff (usually 2–5), and only those. Each one comes from something that went wrong, or nearly did, in this repo.

- **Read this file from main**, not from your branch, so a change can't loosen its own checklist: `git show origin/main:REVIEW.md`.
- **Writing the checks down:** a matched item is done when its check is done, or when the commit message says why it doesn't apply.
- **The commit line:** list the items you checked in the commit's `Verified:` line (see CLAUDE.md), for example `Verified: verify (8 screens, real), REVIEW 2,3`.
- **Adding an item:** only for a mistake seen at least twice, or once with real harm, and only when its trigger can be read from a diff. The user approves new items. Remove items that no longer catch anything.

## Money and books

### 1. Posting, VAT or the money maths
- **Trigger:** `backend/src/services/(books|vat|statements|payroll|assets)/`, `*Posting*`, `ledger`, the VAT boxes, or rounding in `utils/money`.
- **Check:**
  - The books still balance (debits = credits) and the VAT return's boxes match the month's sales and bills.
  - Run the property tests (`backend/tests/properties/`) and the e2e money paths (`e2e/`: bill, return, counter, payroll).
  - A rule that changes goes into `.claude/skills/kosovo-tax/reference.md`.
- **Incident:** bfc7ba2 added the property tests so the books balance to the cent and the VAT return matches the books. TREFIN's trial balance is €976.78 off (handoff.md, Accountant), which is what 4VD must never be.

### 2. Dates and day boundaries
- **Trigger:** new date maths in services or reports (`new Date(`, `toISOString().slice(0, 10)`, `between`, `endOf`, `< '…-01'`).
- **Check:**
  - Days are counted on the shop's clock (`SHOP_TIME_ZONE`), not UTC.
  - A date like "31 October" covers that whole day.
  - A month report doesn't count the next month's first day.
- **Incident:** 3c54871, where reports for a month counted the first day of the next month.

## Database

### 3. Migrations
- **Trigger:** any file added or changed in `backend/src/database/migrations/`.
- **Check:**
  - Never edit a migration that is already on main: add a new one. 078 was nearly edited after it had shipped.
  - Give it its number at merge time, against the newest main. Passkeys and tenancy both wanted 080.
  - Register it in `migrations/index.ts`.
  - Set a `lock_timeout` before DDL on big tables.
  - Time it on the 125k-row TREFIN copy. It must not lock sales for more than seconds.
  - `migrate:down` works.
  - Run the full backend suite before merging.
- **Incident:** the 078 near-miss; the 080/081 number clash (2026-11-16).

### 4. New tables and saves that replace a row
- **Trigger:** `createTable(` in a migration, or `onConflict(` / `.doUpdateSet(` anywhere in `backend/src`.
- **Check:**
  - The new table has `business_id INT NOT NULL DEFAULT current_business_id()`, or is listed with a reason in `backend/src/database/globalTables.ts`.
  - Unique keys and conflict targets include `business_id`.
  - `tests/businessColumns.test.ts` is green.
- **Incident:** 8daf075 and 72ac6d3: four saves, a locked two-step sign-in and the backup check wrote outside the shop's business.

### 5. Connections, business context, caches
- **Trigger:** `database/(connection|businessGuard|businessContext|roleCheck).ts`, a new module-level cache or `Map` in a service, `AsyncLocalStorage`, or a pool setting.
- **Check:**
  - A rolled-back transaction can't leave a business, role or setting behind on a pooled connection. Test it: roll back, then make a request for another business.
  - A cache is keyed by business.
  - Timers run through `forEachBusiness`.
- **Incident:** tenancy phases 3 and 4 (0809b42, 6c7b052). A cached business on a reused connection would show one business's rows to another.

### 6. Postgres version
- **Trigger:** `postgres:` or `image:` versions in `.github/workflows/*.yml` or docker files, or a note that Render's database was upgraded.
- **Check:** `pg_dump` and `pg_restore` in `backup.yml` and `restore-check.yml` match the live server's major version. Run the restore check by hand once after the change.
- **Incident:** 9bdc267. After the live upgrade to 18 the weekly backup's older `pg_dump` refused to copy the newer server.

## Sign-in and devices

### 7. Sign-in, sessions, cookies, origins
- **Trigger:** `backend/src/(routes/auth|middlewares/authenticate|utils/sessionCookies)`, passkeys, two-step, `CORS_ORIGINS` / `DASHBOARD_URL`, `admin/src/services/apiClient.ts`, or `desktop/`.
- **Check:**
  - Every sign-in still works: the dashboard (password, passkey, two-step), the Counter PIN on the shop PC, and the Windows app (its origin is allowed, and its cookies survive a restart).
  - Run verify on `/login` → `/` and `/counter` (`screens.mjs --db real --paths /,/counter`).
  - Name what can only be tried on the shop PC in progress.md "To test by hand".
- **Why:** the security merge moved sign-in to cookies with an origin check (`security-sign-in-for-e2e.md` in the session notes), and the e2e sign-in had to change with it. The Counter on the shop PC and the Windows app sign in the same way and are only tried by hand, so a break there shows up at the till.

## CI and deploys

### 8. CI time and gating
- **Trigger:** `.github/workflows/`, a new slow test file, or a test that starts a server or a browser.
- **Check:**
  - The backend job stays well under its 30-minute limit (about 8 minutes after the Nov 2026 speed-ups). Split it into shards rather than raising the limit.
  - The dashboard deploy still `needs` the checks.
- **Incident:** b8e1aff, where the suite outgrew 15 minutes and every run on main was stopped. dd30e4c made the deploy wait for the checks.

### 9. Dependencies
- **Trigger:** `package.json` or `package-lock.json` in any app.
- **Check:**
  - `npm audit --audit-level=high` is clean (CI refuses high holes; the Windows app only warns).
  - An Electron major goes through a test on the shop PC.
- **Incident:** 47844fd and 1211c42.

### 10. The bill mail worker
- **Trigger:** `mail/`.
- **Check:** it has no public web address (`workers_dev` off), `npm test` in `mail/` passes, and you deploy it by hand afterwards (docs/DEPLOYMENT.md).
- **Incident:** 26bdcb6.

## Tests and fixing

### 11. Flaky tests and fix loops
- **Trigger:** a test diff adding `.skip`, `retries`, `waitForTimeout`, `sleep`, or a bigger timeout.
- **Check:**
  - Follow CLAUDE.md (c9f0886): find the cause. Never retry until green. If the cause can't be found, delete the test and say why.
  - Stop after 3 failed fix rounds and tell the orchestrator.
- **Incident:** c9f0886.

### 12. Screens that print
- **Trigger:** print CSS (`@media print`), or `window.print` in offers, statements, stock move notes or the portal statement.
- **Check:** open the print preview of an offer and a customer statement on the demo database; the page isn't blank.
- **Incident:** 8975dc9, where printing offers and statements gave a blank page.
