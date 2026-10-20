# 4VD

Stock, sales, money and books for the Dacaj family's shop and carwashes, built to replace TREFIN (the old till and accounting program) and later to be sold as a product.

## What's in it
- **Dashboard** (`admin/`, 4vd.app): the one app. Owners and admins get the full back office (stock, buying, sales, money, VAT and books, people, reports, Excel exports). Employees get a phone-style layout (Home, Products, Sell, Account). The accountant sees only the money side.
- **Counter** (`/counter` in the dashboard): the full-screen till, scanner first, with fiscal receipts on the shop's Datecs printer.
- **4VD for Windows** (`desktop/`): an Electron app for the shop PC that runs the dashboard and talks to the fiscal printer. Download it from the dashboard's `/download` page.
- **API** (`backend/`): Express + TypeScript on PostgreSQL.
- `mobile/` holds the old Expo team app, retired since 2026-10-20.

How the code fits together: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Rules for logic, words and look: [DESIGN.md](DESIGN.md). Who it's for: [PRODUCT.md](PRODUCT.md). Task list: [progress.md](progress.md). Hosting: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Local setup

Needs Node.js 22+, npm and Docker Desktop.

**1. Database** (from the repo root):
```bash
docker compose up -d
```
This starts PostgreSQL on port 5432 with `four_vd_app` for your data and `four_vd_app_test`, which the tests wipe.

**2. Backend** (http://localhost:3000):
```bash
cd backend
npm install
cp .env.example .env     # set JWT_SECRET and the SEED_ADMIN_* values
npm run db:setup         # tables, starter categories and your admin account
npm run seed:demo        # optional: demo products, a month of sales and demo logins (never in production)
npm run dev
```
After pulling new code, run `npm run migrate`; the server doesn't migrate on start. Check it's up: `curl http://localhost:3000/health`.

**3. Dashboard** (http://localhost:5173):
```bash
cd admin
npm install
cp .env.example .env
npm run dev
```
Log in with `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` from `backend/.env`.

### Demo logins

`npm run seed:demo` creates one account per role. The passwords are public on purpose, so it refuses to run when `NODE_ENV=production`. Running it again resets them.

| Role | Email | Password |
|---|---|---|
| Admin | `demo-admin@4vd.local` | `demo-admin-4vd` |
| Employee | `demo-employee@4vd.local` | `demo-employee-4vd` |
| Family | `demo-family@4vd.local` | `demo-family-4vd` |
| Accountant | `demo-accountant@4vd.local` | `demo-accountant-4vd` |

## Checks

These are what CI runs on every push:
```bash
cd backend && npm run typecheck && npm test && npm run build
cd admin && npm run lint && npm test && npm run build
```
The backend tests need the Docker database running and take about 10 minutes. With the dashboard running, `npm run lint:ui` in `admin/` checks it against `admin/ui-policy.json`.

## Environment variables
Every app has a `.env.example` listing what it needs. Copy it to `.env` and fill it in. Never commit `.env` files.

## License

[MIT](LICENSE)
