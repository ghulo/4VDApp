# 4VD App

Logistics and inventory app. It keeps track of every item the business holds, how much stock is left, what has sold, and what the numbers look like over time.

## Tech Stack
- **Backend:** Node.js + Express + TypeScript
- **Database:** PostgreSQL
- **Mobile:** React Native with Expo + TypeScript (iOS/Android)
- **Admin Dashboard:** React + Vite + TypeScript

## Features

### Mobile App (Family & Employees)
- [ ] Product catalog with images
- [ ] Stock availability display
- [ ] Price display (single unit + bulk pricing tiers)
- [ ] Search & filter products by category
- [ ] Push notifications for low stock
- [ ] Favorites/wishlist

### Admin Dashboard
- [ ] Real-time inventory tracking
- [ ] Sales analytics & revenue trends
- [ ] Bulk pricing management
- [ ] Add/edit/delete products with image upload
- [ ] Revenue reports & sales history
- [ ] Low stock alerts
- [ ] User activity logs
- [ ] Inventory forecasting

## Project Structure
```
4VDApp/
├── backend/          # Express REST API (see docs/ARCHITECTURE.md for layers)
│   ├── src/
│   │   ├── config/
│   │   ├── constants/
│   │   ├── controllers/
│   │   ├── errors/
│   │   ├── middlewares/
│   │   ├── models/
│   │   ├── repositories/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── types/
│   │   ├── utils/
│   │   ├── validators/
│   │   ├── app.ts
│   │   └── server.ts
│   ├── tests/
│   └── .env.example
├── admin/            # React admin dashboard
│   ├── src/
│   └── .env.example
├── mobile/           # Expo React Native app
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
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
```

Each app is its own npm package with its own `package.json`, so you install and run them separately.

## Getting Started

### Prerequisites
- Node.js v22 LTS or newer
- PostgreSQL v14 or newer
- npm
- Expo Go on your phone, or an iOS/Android simulator

### Local Setup

**Backend** (runs on http://localhost:3000):
```bash
cd backend
npm install
cp .env.example .env   # then fill in your database credentials and JWT secret
npm run dev
```
Check it is up: `curl http://localhost:3000/health`

**Admin dashboard** (runs on http://localhost:5173):
```bash
cd admin
npm install
cp .env.example .env
npm run dev
```

**Mobile:**
```bash
cd mobile
npm install
cp .env.example .env
npm start
# Scan the QR code with Expo Go, or press i / a for a simulator
```

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
- Phase: Planning and beginning of development
- Last Updated: 2026-10-01
