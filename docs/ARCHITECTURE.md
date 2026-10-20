# How 4VD fits together

A short map of the code as it is. Product and design rules live in `DESIGN.md`; who it's for in `PRODUCT.md`; hosting in `docs/DEPLOYMENT.md`.

## Pieces

| Folder | What it is |
|---|---|
| `backend/` | Express 5 + TypeScript API on Postgres, queries through Kysely, input checked with zod |
| `admin/` | The dashboard: React + Vite, plain CSS on the tokens in `admin/src/styles/tokens.css`. Owners get the full menu, employees `StaffLayout`, the till is `/counter` |
| `desktop/` | Electron shell for the shop PC: loads the dashboard, prints fiscal receipts through F-Link, updates itself from GitHub Releases |
| `admin/wrangler.jsonc` | Serves the dashboard at 4vd.app; app.4vd.app (old QR labels) redirects there (Cloudflare rule) |
| `mobile/` | Retired Expo team app, kept for reference only |

## Backend: one request

`routes/` → middleware (`authenticate.ts`: who is asking, `requireRole` / `requirePower`) → `controllers/` (read the request, validate with `validators/`, call one service, answer with `sendSuccess` from `utils/apiResponse.ts`) → `services/` (the business rules) → `repositories/` (SQL through Kysely, nothing else).

- **Wiring:** `container.ts` creates every repository and service once and passes them in through constructors. Tests build their own container with fakes (push, email, Google).
- **Errors:** throw an `AppError` subclass from `errors/httpErrors.ts` (`ValidationError`, `NotFoundError`, `ForbiddenError`…); `middlewares/errorHandler.ts` turns it into `{ success: false, error, message }`. Anything else is logged and answered as a plain 500; logged errors also email the developers (at most hourly, `ErrorAlertService`).
- **Answers** always look like `{ success, data, message, error, meta? }`.
- **Roles:** `developer`, `admin`, `owner`, `employee`, `family`, `accountant` (`database/types.ts`). What each may do is a grid of powers the developer edits in Settings → Roles (`PermissionService`, read on every request through `utils/roles.ts`). "View as" answers as another role and saves nothing.
- **History:** every change that matters writes an Activity entry with from/to details (`ActivityLogService`); `services/undo/` reverses them. Deleted records are soft-deleted (`deleted_at`).
- **Money and VAT:** selling prices are VAT-inclusive (whether costs are net or gross is still being settled with the accountant); sums go through `roundMoney` (`utils/money.ts`); sales and bills post to the books (`services/books/`). A filed VAT month is locked (`services/vat/periodLock.ts`, `assertMonthsOpen`): nothing dated in it may change until it is reopened with a reason.
- **Dates:** stored as `TIMESTAMPTZ` (UTC); "the day" is worked out in the shop's time zone (`utils/zonedDates.ts`).
- **Background work:** `server.ts` runs timers for the daily summary and push alerts; AI calls (bill reading, categorising, Ask) live in `services/ai/` and need `ANTHROPIC_API_KEY`.

## Database

- Migrations are numbered TypeScript files in `backend/src/database/migrations/` (`NNN_name.ts`, each with `up` and `down`). Add the next number; never edit one that has run. `npm run migrate` / `npm run migrate:down`.
- Local Postgres runs in Docker (`four-vd-app-postgres`). App DB `four_vd_app`, test DB `four_vd_app_test`.
- The database guards itself where it can: CHECK constraints against negative stock and prices, foreign keys, unique keys.

## Tests

- Backend (`backend/tests/`, vitest + supertest): mostly integration tests against `TEST_DATABASE_URL`. `tests/helpers/testApp.ts` refuses a URL without "test" in it, builds a fresh schema per file, and files run one at a time because they share the DB.
- Dashboard (`admin/`, vitest + Testing Library): components, formatting, contrast and token rules (`src/theme/*.test.ts`).
- `admin` `npm run lint:ui` (lintapple) checks a running dashboard against `admin/ui-policy.json`.

## Dashboard

- Pages in `admin/src/pages/`, shared pieces in `admin/src/components/ui/` (the kit: `Button`, `Card`, `DataTable`, `Sheet`, `Inspector`, `PageHeader`…).
- API calls through `admin/src/services/apiClient.ts`; every string comes from the EN/SQ catalogues in `admin/src/i18n/` (tests fail on missing keys).
- Menu: `admin/src/navigation/sections.ts`; staff tabs: `navigation/staff.ts`.
