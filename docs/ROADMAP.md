# Roadmap

Agreed on 2026-10-01. "Logistics" for 4VD means what the app already does
(products, stock, team sales, pricing, alerts, reports), made more polished,
with as many tools as possible for the owner and a smarter system overall.
It does not mean deliveries or several warehouses.

Order: get the data right first, then build the smart parts on top of it.

| # | Piece | Covers | Status |
|---|---|---|---|
| 0 | Lock-down and polish | Login required for all data, fixes from the reports review, docs | Done |
| 0b | Employee home screen | A Home tab in the mobile app with today's numbers and every tool | Done |
| 1 | Returns and stock counts | Undo or partly refund a sale; count shelves and approve the differences; write off damaged, lost or expired stock with a reason | Done |
| 2 | Price control and team | Time-limited discounts, price history, a minimum margin; sales targets and commission. Finer permissions left for later | Done |
| 3 | Push notifications | Phone (Expo push) and PC (browser) alerts with per-person settings | Done (phone alerts need `eas init`, see DEPLOYMENT.md) |
| 4 | Smart layer | Run-out forecasts and reorder advice that follow busy and quiet periods; warnings for missing stock, unusual sales, dead stock and sales below cost; a daily owner summary sent through piece 3 | Not started |
| 5 | AI helpers | Questions in plain words, price suggestions, invoice scanning, suppliers and purchase orders, product photos, barcodes. Uses a paid AI service (pennies per use) | Not started |
| 6 | Store link | API key for the online store; stock reserved and reduced on orders | When the store exists |

## Before going live

- Deploy: backend and database on Render, admin dashboard hosted, GitHub Actions running tests on every push.
- Phones for free: Android APK, and the mobile app as a home-screen web app for iPhone. The paid App Store and Play Store come later.
- Production basics: Sentry error tracking, database backups, a real admin with a new password, no demo data.
