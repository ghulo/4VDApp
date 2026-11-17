# How 4VD fits together

A short map of the code as it is. Product and design rules live in `DESIGN.md`; who it's for in `PRODUCT.md`; hosting in `docs/DEPLOYMENT.md`.

## Pieces

| Folder | What it is |
|---|---|
| `backend/` | Express 5 + TypeScript API on Postgres, queries through Kysely, input checked with zod |
| `admin/` | The dashboard: React + Vite, plain CSS on the tokens in `admin/src/styles/tokens.css`. Owners get the full menu, employees `StaffLayout`, the till is `/counter` |
| `desktop/` | Electron shell for the shop PC: loads the dashboard, prints fiscal receipts through F-Link, updates itself from GitHub Releases |
| `admin/wrangler.jsonc` | Serves the dashboard at 4vd.app; app.4vd.app (old QR labels) redirects there (Cloudflare rule) |
| `mail/` | Cloudflare Email Worker for bills@4vd.app: checks SPF/DKIM, passes supplier bills to `POST /api/internal/bill-email` (deployed by hand with wrangler) |
| `mobile/` | Retired Expo team app, kept for reference only |

## Backend: one request

`routes/` → middleware (`authenticate.ts`: who is asking, `requireRole` / `requirePower`) → `controllers/` (read the request, validate with `validators/`, call one service, answer with `sendSuccess` from `utils/apiResponse.ts`) → `services/` (the business rules) → `repositories/` (SQL through Kysely, nothing else).

- **Wiring:** `container.ts` creates every repository and service once and passes them in through constructors. Tests build their own container with fakes (push, email, Google).
- **Errors:** throw an `AppError` subclass from `errors/httpErrors.ts` (`ValidationError`, `NotFoundError`, `ForbiddenError`…); `middlewares/errorHandler.ts` turns it into `{ success: false, error, message }`. Anything else is logged and answered as a plain 500; logged errors also email the developers (at most hourly, `ErrorAlertService`).
- **Answers** always look like `{ success, data, message, error, meta? }`.
- **Roles:** `developer`, `admin`, `owner`, `employee`, `family`, `accountant` (`database/types.ts`). What each may do is a grid of powers the developer edits in Settings → Roles (`PermissionService`, read on every request through `utils/roles.ts`). "View as" answers as another role and saves nothing.
- **Sign-in:** the dashboard keeps its session in two httpOnly, Secure, SameSite=Lax cookies set by the API (`vd_access` for `/api`, `vd_refresh` for `/api/auth`; `utils/sessionCookies.ts`). A browser (any request with an Origin) never gets the tokens in the answer; scripts and tests still sign in with a Bearer token. Against cross-site forgery, a change (anything but GET) from another origin is refused, and the cookie only counts on a change whose Origin is 4VD's own (`refuseForeignOrigins`, `cookieMayAct`). The portal has its own cookie (`portal_session`, `/api/portal`); neither side accepts the other's. Optional two-step sign-in (TOTP, `services/TwoStepService.ts`, `utils/totp.ts`): with it on, the password or Google gives a five-minute challenge, not a session, until `POST /api/auth/two-step` gets a right code; secrets are encrypted with `TOTP_KEY` (or a key derived from `JWT_SECRET`). Passkeys (WebAuthn, `services/PasskeyService.ts`, @simplewebauthn): a full sign-in that counts as both steps (the device checks the person: user verification is required on the server), or a stand-in for the code after the password. They belong to the dashboard's host (`DASHBOARD_URL`, so 4vd.app; the API checks the origin), live in the global `passkeys` table (per person, not per business), and each challenge works once (kept in memory: the API is one process). A use count that goes backwards is refused and logged as a copied key; synced passkeys always report 0. Not offered on the Counter (shared PC).
- **Who may call what:** `backend/tests/accessAudit.test.ts` calls every route as signed out, a portal customer and each role, and compares with a hand-written table (`ACCESS`). A new route fails it until it is added there with who may use it.
- **History:** every change that matters writes an Activity entry with from/to details (`ActivityLogService`); `services/undo/` reverses them. Deleted records are soft-deleted (`deleted_at`).
- **Money and VAT:** selling prices are VAT-inclusive (whether costs are net or gross is still being settled with the accountant); sums go through `roundMoney` (`utils/money.ts`); sales and bills post to the books (`services/books/`). A filed VAT month is locked (`services/vat/periodLock.ts`, `assertMonthsOpen`): nothing dated in it may change until it is reopened with a reason.
- **Dates:** stored as `TIMESTAMPTZ` (UTC); "the day" is worked out in the shop's time zone (`utils/zonedDates.ts`).
- **Background work:** `server.ts` runs timers for the daily summary and push alerts; AI calls (bill reading, categorising, Ask) live in `services/ai/` and need `ANTHROPIC_API_KEY`.

## Database

- Migrations are numbered TypeScript files in `backend/src/database/migrations/` (`NNN_name.ts`, each with `up` and `down`). Add the next number; never edit one that has run. `npm run migrate` / `npm run migrate:down`.
- Local Postgres runs in Docker (`four-vd-app-postgres`). App DB `four_vd_app`, test DB `four_vd_app_test`.
- **Many businesses:** every table carries `business_id` (default `current_business_id()`, from the request's `app.business_id` setting), except the global ones in `backend/src/database/globalTables.ts` (people, sign-in tokens, the business list). A new table must add `business_id INT NOT NULL DEFAULT current_business_id()`; `tests/businessColumns.test.ts` fails otherwise. People work for businesses through `memberships`; businesses belong to a `tenant` (who pays).
- The database guards itself where it can: CHECK constraints against negative stock and prices, foreign keys, unique keys.

## Tests

- Backend (`backend/tests/`, vitest + supertest): mostly integration tests against `TEST_DATABASE_URL`. `tests/helpers/testApp.ts` refuses a URL without "test" in it, builds a fresh schema per file, and files run one at a time because they share the DB.
- Dashboard (`admin/`, vitest + Testing Library): components, formatting, contrast and token rules (`src/theme/*.test.ts`).
- Dependencies: Dependabot (`.github/dependabot.yml`) opens monthly grouped minor and patch updates (majors are done by hand); CI runs `npm audit --audit-level=high` for each app, so a known high-risk package stops the deploy.
- `admin` `npm run lint:ui` (lintapple) checks a running dashboard against `admin/ui-policy.json`.

## Dashboard

- Pages in `admin/src/pages/`, shared pieces in `admin/src/components/ui/` (the kit: `Button`, `Card`, `DataTable`, `Sheet`, `Inspector`, `PageHeader`…).
- API calls through `admin/src/services/apiClient.ts`; every string comes from the EN/SQ catalogues in `admin/src/i18n/` (tests fail on missing keys).
- Menu: `admin/src/navigation/sections.ts`; staff tabs: `navigation/staff.ts`.
