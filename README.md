# 4VD

A business program for small shops in Kosovo: stock, sales and the till, buying, money, payroll, and the books and tax returns, in one web app. It was built for the Dacaj family's shop and carwashes (4VD = "4 Vëllezërit Dacaj", the four Dacaj brothers) to replace TREFIN, their old till and accounting program. The goal is to run every 4VD business on it, accounting included, and then sell it to other businesses. It already serves many businesses from one installation, and each one's data is kept apart.

Live at [4vd.app](https://4vd.app). Who it's for and why: [PRODUCT.md](PRODUCT.md).

## What it does

- **Selling:** the Counter (`/counter`), a full-screen, scanner-first till that prints legal receipts on the shop's fiscal printer; several baskets at once, returns, customer tabs with limits, offers, deliveries, short-dated discounts, serial numbers.
- **Stock and buying:** products with barcodes, pack sizes, units and price lists; counts, write-offs, stock in and out documents, several locations; suppliers, orders and every kind of supplier bill, read from a photo, a PDF or an email to bills@4vd.app.
- **Money:** tills, safe and bank accounts, money moves, bank statements matched to bills and invoices, the daily cash check and close-the-day list, carwash takings.
- **Books and tax (Kosovo):** double-entry books on a 144-account chart, the monthly VAT return and ATK sales and purchase books, financial statements, year close and profit-tax instalments, the yearly CD/PD declaration, fixed assets, payroll with wage tax and Trust pension.
- **People:** roles with an editable permission grid, employees on a phone-style layout, an accountant login for the money side, a portal where business customers order and read their invoices.
- **Many businesses:** one sign-in can work in several businesses; each has its own data, colours, logo and bill address.
- **Moving in:** Settings → Import brings products, suppliers and customers from another program's files; a script imports a full TREFIN history.
- Everything in English and Albanian, light and dark, on a PC or a phone.

## Status (November 2026)

- **Live at 4vd.app:** everything above. Roadmap steps 0–19 are done (see progress.md), plus many businesses with row security, passkeys and two-step sign-in, a business's own look, and the importer.
- **Still on test data:** at launch the data is wiped and TREFIN's history imported; then 4VD runs one VAT month next to TREFIN with the accountant. Some tax defaults wait for the accountant's answer (marked in code).
- **Next:** a polish pass over the UI kit, then step 23: 4VD for Windows as a full program whose Counter keeps selling without internet.
- **Later:** a cash forecast (20), all businesses in one view (21), digital receipts and loyalty by phone number (22).

The roadmap, and what still needs trying by hand: [progress.md](progress.md).

## Repository

| Folder | What it is |
|---|---|
| `backend/` | The API: Express 5 + TypeScript on PostgreSQL (Kysely, zod), with migrations, scripts and tests |
| `admin/` | The dashboard (React + Vite): the only app people use, served at 4vd.app |
| `desktop/` | 4VD for Windows (Electron): opens the dashboard on the shop PC and drives the fiscal printer |
| `mail/` | Cloudflare Email Worker that passes supplier bills sent to bills@4vd.app to the API |
| `e2e/` | Playwright browser tests of the money paths (bill, return, Counter, payroll) |
| `brand/` | Logo source files and the icon and palette scripts |
| `docs/` | Architecture, deployment, and an archive of finished work |
| `.claude/skills/` | Instructions for AI coding sessions (`kosovo-tax`, `step-workflow`, `verify`, and design helpers) |

The old Expo team app (`mobile/`, retired 2026-10-20) was removed on 2026-11-19 (last in commit 3cbaf85b; see git history).

## Quick start

Needs Node.js 22+, npm and Docker Desktop.

```bash
docker compose up -d          # Postgres on 5432: four_vd_app, plus four_vd_app_test for the tests

cd backend
npm install
cp .env.example .env          # set JWT_SECRET and the SEED_ADMIN_* values
npm run db:setup              # migrate, starter categories and your admin account
npm run seed:demo             # optional: demo products, a month of sales, demo logins
npm run dev                   # http://localhost:3000 (check: /health)

cd ../admin
npm install
cp .env.example .env
npm run dev                   # http://localhost:5173
```

Sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `backend/.env`. After pulling new code run `npm run migrate` in `backend/` (the local dev server doesn't migrate; the production container does on start).

**Demo logins** (from `seed:demo`; public on purpose, so it refuses to run in production; running it again resets them): `demo-admin@4vd.local` / `demo-admin-4vd`, and the same pattern for `demo-employee`, `demo-family` and `demo-accountant`.

## Checks

GitHub runs these on every push to main, only for the parts the push changed (`.github/workflows/ci.yml`), and nothing goes live until they pass:

```bash
cd backend && npm run typecheck && npm test && npm run build    # tests need the Docker database
cd admin && npm run lint && npm test && npm run build
```

The full backend suite takes about 10 minutes locally (8 on GitHub); while working, run only the tests that cover the change (`npm run test:related -- <files>`). With the dashboard running, `npm run lint:ui` in `admin/` checks it against `admin/ui-policy.json`.

## Read next

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the code fits together (tenancy, sign-in, books, deploys).
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): hosting on Render and Cloudflare, backups, error tracking, one-time setup.
- [DESIGN.md](DESIGN.md): the rulebook for product logic, words and look.
- [REVIEW.md](REVIEW.md): the checklist before a commit.
- [CLAUDE.md](CLAUDE.md): how AI coding sessions work in this repo.

Every app has a `.env.example`; copy it to `.env`. Never commit `.env` files.

## License

Proprietary: copyright (c) 2026 the Dacaj family (4VD), all rights reserved. No use, copying or distribution without written permission ([LICENSE](LICENSE)).
