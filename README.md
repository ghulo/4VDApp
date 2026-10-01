# 4VD App

Logistics and inventory app. It keeps track of every item the business holds, how much stock is left, what has sold, and what the numbers look like over time.

## Tech Stack
- **Backend:** Node.js + Express + TypeScript
- **Database:** PostgreSQL
- **Mobile:** React Native with Expo + TypeScript (iOS/Android)
- **Admin Dashboard:** React + Vite + TypeScript

## Features

### Mobile App (Family & Employees)
- [x] Product catalog with images (image links for now)
- [x] Stock availability display
- [x] Price display (single unit + bulk pricing tiers)
- [x] Search & filter products by category or stock
- [x] Favorites/wishlist
- [x] Record sales (employees and admins)
- [ ] Push notifications for low stock (alerts currently show in the admin dashboard)

### Admin Dashboard
- [x] Real-time inventory tracking with a full stock history
- [x] Sales analytics & revenue trends
- [x] Bulk pricing management
- [x] Add/edit/delete products (image links; file upload not built yet)
- [x] Revenue reports & sales history
- [x] Low stock alerts
- [x] Manage people and their roles
- [ ] User activity logs (only stock changes are logged so far)
- [ ] Inventory forecasting

## Project Structure
```
4VDApp/
├── backend/          # Express REST API (see docs/ARCHITECTURE.md for layers)
│   ├── src/
│   │   ├── config/        # environment variables, checked on startup
│   │   ├── constants/
│   │   ├── controllers/   # parse the request, call a service, send the response
│   │   ├── database/      # connection, table types, migrations
│   │   ├── errors/
│   │   ├── middlewares/   # auth, rate limits, error handling
│   │   ├── repositories/  # all SQL lives here
│   │   ├── routes/
│   │   ├── scripts/       # migrate and seed commands
│   │   ├── services/      # business rules
│   │   ├── types/
│   │   ├── utils/
│   │   ├── validators/    # request schemas (zod)
│   │   ├── app.ts
│   │   ├── container.ts   # wires repositories and services together
│   │   └── server.ts
│   ├── tests/
│   └── .env.example
├── admin/            # React admin dashboard
│   ├── src/
│   │   ├── auth/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/      # API client
│   │   └── utils/
│   └── .env.example
├── mobile/           # Expo React Native app
│   ├── src/
│   │   ├── components/
│   │   ├── navigation/
│   │   ├── screens/
│   │   ├── services/
│   │   ├── state/
│   │   ├── utils/
│   │   └── App.tsx
│   └── .env.example
└── docs/
    ├── API.md
    ├── ARCHITECTURE.md
    ├── DATABASE.md
    ├── DEPLOYMENT.md
    └── ENGINEERING_RULES.md
docker-compose.yml    # local PostgreSQL
```

Each app is its own npm package with its own `package.json`, so you install and run them separately.

## Getting Started

### Prerequisites
- Node.js v22 LTS or newer
- Docker Desktop (runs PostgreSQL locally), or your own PostgreSQL 14+
- npm
- Expo Go on your phone, or an iOS/Android simulator

### Local Setup

**1. Database** (from the repo root):
```bash
docker compose up -d
```
This starts PostgreSQL on port 5432 with two databases: `four_vd_app` for your data and `four_vd_app_test`, which the tests wipe.

**2. Backend** (runs on http://localhost:3000):
```bash
cd backend
npm install
cp .env.example .env     # set JWT_SECRET and the SEED_ADMIN_* values
npm run db:setup         # creates the tables, starter categories and your admin account
npm run seed:demo       # optional: demo products, a month of sales and demo logins (never in production)
npm run dev
```
After pulling new code, run `npm run migrate` to add any new tables; the server doesn't do it on start.

Check it's up: `curl http://localhost:3000/health`

**3. Admin dashboard** (runs on http://localhost:5173):
```bash
cd admin
npm install
cp .env.example .env
npm run dev
```
Log in with `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` from `backend/.env`.

**4. Mobile:**
```bash
cd mobile
npm install
cp .env.example .env     # set EXPO_PUBLIC_API_URL to your computer's Wi-Fi IP, e.g. http://192.168.0.20:3000
npm start
```
Scan the QR code with Expo Go (phone and computer on the same Wi-Fi). On Windows, if the phone can't connect, allow Node.js through the firewall for private networks.

**5. Try the mobile app in a browser** (no phone needed):
```bash
cd mobile
npm run web              # opens http://localhost:8081
```
It shows phone-width in the middle of the window. The login is kept in the browser's storage instead of the phone's keychain.

### Demo logins

`npm run seed:demo` creates one account per role on your local database. The passwords are public on purpose, so the command refuses to run when `NODE_ENV=production`.

| Role | Email | Password |
|---|---|---|
| Admin | `demo-admin@4vd.local` | `demo-admin-4vd` |
| Employee | `demo-employee@4vd.local` | `demo-employee-4vd` |
| Family | `demo-family@4vd.local` | `demo-family-4vd` |

Running it again resets them if a password was changed or an account was switched off.

### Tests
```bash
cd backend
npm test           # unit + integration tests (needs the Docker database running)
npm run typecheck
```
For the front ends: `cd admin && npm run build && npm run lint`, and `cd mobile && npm run typecheck`.

## Environment Variables
Every app has a `.env.example` listing what it needs. Copy it to `.env` and fill it in. Never commit `.env` files.

## Documentation
- [API endpoints](docs/API.md)
- [Architecture & design patterns](docs/ARCHITECTURE.md)
- [Database schema](docs/DATABASE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Engineering rules](docs/ENGINEERING_RULES.md)

## Team & Access
- **Admin/Developer:** Labi
- **Users:** Family, employees
- **Roles:** Admin, Employee, Family Member

## Project Status
- Phase: First full version, running locally. Not deployed yet
- Last Updated: 2026-10-01
