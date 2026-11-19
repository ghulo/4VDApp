# How 4VD fits together

A map of the code as it is: each claim names the file or symbol to read next. What 4VD is and who it's for: [PRODUCT.md](../PRODUCT.md). Rules for logic, words and look: [DESIGN.md](../DESIGN.md). Hosting and one-time setup: [DEPLOYMENT.md](DEPLOYMENT.md). Kosovo tax and accounting rules: the `kosovo-tax` skill (`.claude/skills/kosovo-tax/`).

## The system

```
 browser / phone ──► 4vd.app (Cloudflare Worker, static admin/ build)
 shop PC: 4VD for Windows (desktop/) ──┘        │  fetch, cookies
                                                ▼
 bills@4vd.app ─► mail/ Email Worker ─► api.4vd.app (Render: backend/, one Node process + timers)
                                                │
                                                ▼
                                     Postgres 18 (Render), row security per business
                                     weekly encrypted copy ─► Cloudflare R2
```

| Folder | What it is |
|---|---|
| `backend/` | Express 5 + TypeScript API on Postgres, queries through Kysely, input checked with zod |
| `admin/` | The dashboard: React + Vite, plain CSS on the tokens in `admin/src/styles/tokens.css`. Owners get the full menu, employees and family `StaffLayout`, the till is `/counter`, business customers `/portal`. Served at 4vd.app by `admin/wrangler.jsonc`; app.4vd.app (old QR labels) redirects there by a Cloudflare rule |
| `desktop/` | Electron shell for the shop PC: loads 4vd.app, prints fiscal receipts on the Datecs printer through Enternet's F-Link (`src/fiscal.js`), shows its own page when offline, updates itself from GitHub Releases |
| `mail/` | Cloudflare Email Worker for bills@4vd.app: checks SPF/DKIM/DMARC, passes supplier bills to `POST /api/internal/bill-email` (deployed by hand with wrangler) |
| `e2e/` | Playwright tests of the money paths against their own API and dashboard (ports 3100/5180, database `four_vd_app_e2e`) |

The old Expo team app (`mobile/`) was retired on 2026-10-20 and removed on 2026-11-19 (last in commit 3cbaf85b; see git history).

## Many businesses (tenancy)

One installation serves many businesses; a business's rows are invisible to every other.

- **The column:** every table carries `business_id INT NOT NULL DEFAULT current_business_id()`, except the global ones listed with a reason in `backend/src/database/globalTables.ts` (people, sign-in tokens, passkeys, the business list). `tests/businessColumns.test.ts` fails on a new table without it. Unique keys and conflict targets include `business_id`.
- **The current business:** `database/businessContext.ts` keeps it in AsyncLocalStorage. Sign-in (`requireAuth`, the portal) names it with `enterBusiness`; timers and scripts use `runAsBusiness` and `forEachBusiness` (`database/business.ts`, `timers.ts`); `runAsSystem` marks work before anyone's business is known and may only touch global tables. `database/businessGuard.ts` tells each pooled connection the business (`app.business_id`) every time it is taken, so a reused connection never keeps the last request's business.
- **Row security:** migration 081 turns on and forces row-level security on every business table (`business_rows` policy). Live, the API connects as `fourvd_app`, which isn't the owner and has no BYPASSRLS; `database/roleCheck.ts` refuses to start in production as a superuser or BYPASSRLS role. Migrations and backups run as the owner (`app.maintenance=on` lets them see every business). Details: DEPLOYMENT.md, "The app's own database role".
- **People and businesses:** a person (`users`) works in businesses through `memberships`, each with its own role; one sign-in can switch between them from the account menu. Businesses belong to a `tenant` (who pays). Roles a person can hold: `main_admin`, `admin`, `owner`, `employee`, `family`, `accountant` (`STORED_ROLES` in `database/types.ts`). `developer` is 4VD's own staff (`users.is_platform_developer`, set by hand): may add businesses (`AddBusinessService`), opens a business as a recorded support visit (`support_visits`, shown to that business in Settings → Support visits), and sees every business's history in All logs (`/all-logs`, read through SECURITY DEFINER functions from migration 088).
- **A business's own look:** name, logo, colour and receipt lines (`services/brand.ts`, `admin/src/theme/brandTheme.ts`), used on the dashboard, its sign-in link, the portal and emails. 4VD's own business keeps 4VD's look. Each business also has a short name for its bill address `bills+<short>@4vd.app`.
- `npm run export:business` writes one business's data to files for its owner.

## Backend: one request

`routes/` → middleware (`authenticate.ts`: who is asking, `requireRole` / `requirePower`) → `controllers/` (read the request, validate with `validators/`, call one service, answer with `sendSuccess` from `utils/apiResponse.ts`) → `services/` (the business rules) → `repositories/` (SQL through Kysely, nothing else).

- **Wiring:** `container.ts` creates every repository and service once and passes them in through constructors. Tests build their own container with fakes (push, email, Google).
- **Errors:** throw an `AppError` subclass from `errors/httpErrors.ts` (`ValidationError`, `NotFoundError`, `ForbiddenError`…); `middlewares/errorHandler.ts` turns it into `{ success: false, error, message }`. Anything else is logged and answered as a plain 500; logged errors go to Sentry and email the developers (at most hourly, `ErrorAlertService`).
- **Answers** always look like `{ success, data, message, error, meta? }`.
- **Powers:** what each role may do is a grid of powers per business, edited in Settings → Roles (`PermissionService`, read on every request through `utils/roles.ts`). "View as" answers as another role and saves nothing.
- **Sign-in:** the dashboard keeps its session in two httpOnly, Secure, SameSite=Lax cookies set by the API (`vd_access` for `/api`, `vd_refresh` for `/api/auth`; `utils/sessionCookies.ts`). A browser (any request with an Origin) never gets the tokens in the answer; scripts and tests still sign in with a Bearer token. Against cross-site forgery, a change (anything but GET) from another origin is refused, and the cookie only counts on a change whose Origin is 4VD's own (`refuseForeignOrigins`, `cookieMayAct`). The portal has its own cookie (`portal_session`, `/api/portal`); neither side accepts the other's. Optional two-step sign-in (TOTP, `services/TwoStepService.ts`, `utils/totp.ts`): with it on, the password or Google gives a five-minute challenge, not a session, until `POST /api/auth/two-step` gets a right code; secrets are encrypted with `TOTP_KEY` (or a key derived from `JWT_SECRET`). Passkeys (WebAuthn, `services/PasskeyService.ts`, @simplewebauthn): a full sign-in that counts as both steps (user verification is required on the server), or a stand-in for the code after the password. They belong to the dashboard's host (`DASHBOARD_URL`, so 4vd.app), live in the global `passkeys` table (per person, not per business), and each challenge works once (kept in memory: the API is one process). A use count that goes backwards is refused and logged as a copied key. Not offered on the Counter (shared PC), where people take over with a PIN (`CounterPinService`).
- **Who may call what:** `backend/tests/helpers/accessAudit.ts` calls every route as signed out, a portal customer and each role, and compares with a hand-written table (`ACCESS`); three files (`tests/accessAudit*.test.ts`) each run one group of callers. A new route fails it until it is added there with who may use it.
- **History:** every change that matters writes an Activity entry with from/to details (`ActivityLogService`); `services/undo/` reverses them. Deleted records are soft-deleted (`deleted_at`) and can be put back from Settings → Recycle bin.
- **Dates:** stored as `TIMESTAMPTZ` (UTC); "the day" is worked out in the shop's time zone (`SHOP_TIME_ZONE`, `utils/zonedDates.ts`).
- **Background work:** `server.ts` runs `minuteJobs` (reports, alerts, once a minute) and `pushJobs` (push notifications and queued emails, every 5 seconds) from `timers.ts`, each inside every business in turn; a slow run skips a beat rather than overlap. AI calls (bill reading, categorising, bank statements in PDF, Ask) live in `services/ai/` and need `ANTHROPIC_API_KEY`; staff names are masked first.

## Money, books and tax

All amounts go through `roundMoney` (`utils/money.ts`). Every rule, account and rate below is listed with its file in the `kosovo-tax` skill; this is only the map.

| Area | Where |
|---|---|
| Books: chart of accounts, every document posting its own entry | `services/books/` (`BooksPoster`, `postingRules.ts`, `entryBuilder.ts`), `constants/chartOfAccounts.ts` |
| VAT return, sales and purchase books, ATK EDI file, filed-month lock | `services/vat/` (`periodLock.ts`: nothing dated in a filed month changes until it is reopened with a reason) |
| Tills, safe, banks, money moves, bank statements | `MoneyService`, `services/money/` |
| Supplier bills (one form for every kind), bill scans, bills by email | `SupplierBillService`, `services/bills/`, `BillScanService`, `BillEmailService` |
| Financial statements, year close, profit-tax instalments, CD/PD declaration | `services/statements/` |
| Payroll | `services/payroll/` (`payrollRules.ts` holds the law) |
| Fixed assets | `FixedAssetService`, `services/assets/` |
| The carwash, kept outside the books | `CarwashService` |
| Moving from TREFIN: opening balances, side-by-side check | `OpeningService`, `services/vat/TrefinCompareService.ts`, scripts `import:trefin`, `opening:trefin`, `compare:trefin` |

## Imports

Settings → Import (`services/import/`, `ImportService`): files from another program (Excel, CSV, a zip or a whole TREFIN export folder) are read into a draft, the person checks the preview, then it runs in the background in one transaction. Every row it creates or changes is recorded, so Undo takes it back. It brings products, suppliers and customers; full TREFIN history (sales, bills, stock) comes in through `npm run import:trefin`.

## Database

- Migrations are numbered TypeScript files in `backend/src/database/migrations/` (`NNN_name.ts`, each with `up` and `down`), registered in `migrations/index.ts`. Add the next number at merge time; never edit one that has run. `npm run migrate` / `npm run migrate:down`. The production container migrates on start (`backend/Dockerfile`).
- Local Postgres runs in Docker (`four-vd-app-postgres`, `docker-compose.yml`). App DB `four_vd_app`, demo DB `four_vd_app_demo` (for clicking through flows that create data), test DBs per session (CLAUDE.md, "Gotchas").
- The database guards itself where it can: CHECK constraints against negative stock and prices, foreign keys, unique keys, row security.

## Tests

- Backend (`backend/tests/`, vitest + supertest): mostly integration tests against `TEST_DATABASE_URL`. Files run in parallel, one database per vitest worker (`tests/helpers/testDatabases.ts`): a global setup migrates `<name>_tpl` once per run, and `setupTestApp` gives each file a fresh copy as `<name>_w<worker>`. A URL without "test" in its name is refused, and only `_tpl`/`_w<n>` databases are ever dropped. Tests run as the non-superuser `four_vd_app_tester`, so row security applies. Property tests (`tests/properties/`) check that the books balance and the VAT return matches them.
- Dashboard (`admin/`, vitest + Testing Library): components, formatting, contrast and token rules (`src/theme/*.test.ts`). `npm run lint:ui` (lintapple) checks a running dashboard against `admin/ui-policy.json`.
- Browser (`e2e/`): bill, return, Counter and payroll, run on GitHub when backend, admin or e2e change.

## From a push to live

- `.github/workflows/ci.yml` works out which parts changed since the last green commit on main and runs only their checks (backend typecheck, tests and build; admin lint, tests and build; e2e; mail tests; npm audit per app, a warning only for the Windows app). Runs on main queue and never cancel each other.
- When every check passes, its last job `deploy-dashboard` puts `admin/` live at 4vd.app with wrangler, and Render deploys the API (`autoDeployTrigger: checksPass` in `render.yaml`). Render deploys only pushes that change `backend/`. The mail worker and the Windows app are released by hand (DEPLOYMENT.md, `desktop/README.md`).
- Other workflows: `backup.yml` (weekly encrypted copy to R2), `restore-check.yml` (monthly restore of that copy), `uptime.yml` (asks `/health` every 10 minutes). Dependabot opens monthly grouped minor and patch updates.

## Dashboard

- Pages in `admin/src/pages/`, shared pieces in `admin/src/components/ui/` (the kit: `Button`, `Card`, `DataTable`, `Sheet`, `Inspector`, `PageHeader`…, shown at `/kit`).
- API calls through `admin/src/services/apiClient.ts` with TanStack Query; every string comes from the EN/SQ catalogues in `admin/src/i18n/` (tests fail on missing keys).
- Menu: `admin/src/navigation/sections.ts`; staff tabs: `navigation/staff.ts`. Errors go to Sentry (`admin/src/errorTracking.ts`).
