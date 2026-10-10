# 4VD progress

Tasks we agree on in chat. Ticked when done. When everything is ticked, Claude asks whether to add new tasks.

## Flow overhaul

- [x] Phase 1: dashboard menu organised by job, one Inbox for approvals and alerts
- [x] Phase 2: supplier and customer pages, with bills, orders and invoices linking back
- [x] Phase 3: Shop day
  - [x] Backend: end-of-day checklist (cash, carwash, expenses, approvals) and a "No expenses today" tick
  - [x] Dashboard: "Close the day" checklist on Money → Day, plus a link from Overview
  - [x] Team app: Home shows what to do next, selling one tap away, "End shift" leads to the cash count
  - [x] tsc, lint and tests in admin, backend and mobile
  - [x] Playwright screenshots at 375 and 1440, fix what shows up
  - [x] Squash-merge into main, push, delete branch, check GitHub checks, update work-queue.md
- [ ] Phase 4: full visual polish of every screen in both apps (light and dark, EN and SQ)
- [x] Phase 5: hardening, and update the out-of-date PRODUCT.md
  - [x] Security audit of all three apps (backend and dashboard clean; team app findings are only in Expo's build tools, patched to Expo's latest)
  - [x] Server: crashes are logged and alerted, then it restarts clean; shutdown can't hang; the minute-by-minute report job never overlaps itself
  - [x] Both apps show a calm "something went wrong" with a way back instead of a blank screen
  - [x] PRODUCT.md brought up to date (Albanian built, domains, everything the app does now)

## Requests 2026-10-10

- [x] Shop float editable right where the drawer is counted (usually €150, sometimes not), and the float used shows in reports
- [x] Tabs show more detail: who added each charge, who took each payment, and the time (hour:minute)

## Optional

- [ ] Link from a product to the supplier you usually buy it from
