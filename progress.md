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
- [x] Phase 4: full visual polish of every screen in both apps (light and dark, EN and SQ)
  - [x] Pass 1: screenshot every dashboard screen (1440 + 375) and the team app's main screens, fix what shows up (cash check layout, close-the-day badges, card corners, product page spacing, Inbox columns, shorter phone lists for sales and activity, device list capped)
  - [x] Pass 2: team app sub-screens checked; sale screen shows products on the shelf when there are no favourites, Tabs intro, phone filters tidied, accessibility and design-guideline review done
  - [x] You look it over locally and say yes, then merge and push
- [x] Phase 5: hardening, and update the out-of-date PRODUCT.md
  - [x] Security audit of all three apps (backend and dashboard clean; team app findings are only in Expo's build tools, patched to Expo's latest)
  - [x] Server: crashes are logged and alerted, then it restarts clean; shutdown can't hang; the minute-by-minute report job never overlaps itself
  - [x] Both apps show a calm "something went wrong" with a way back instead of a blank screen
  - [x] PRODUCT.md brought up to date (Albanian built, domains, everything the app does now)

## Requests 2026-10-10

- [x] Shop float editable right where the drawer is counted (usually €150, sometimes not), and the float used shows in reports
- [x] Tabs show more detail: who added each charge, who took each payment, and the time (hour:minute)

## Look (DESIGN.md gap list)

- [x] Warm status colours and an ink focus ring in both apps
- [x] Buttons: thinner 2px edge, no jump on hover, disabled buttons sit flat instead of half see-through
- [x] Glass: one clean recipe; the top bar only turns to glass once the page scrolls under it
- [x] Overview: what needs you comes first and largest; the Today panel is a slim strip with a small sunrise; zero counts hidden; title is "Overview"
- [x] Reports: big figures drop the cents, rises say a number ("12×") instead of "Much more", one huge day no longer flattens the graphs, cards line up in even rows
- [x] Every table is the shared table component (Sales, Promotions, Orders, stock count, price history, Reports, chart "Show as table"), so none sits as a box inside a card
- [x] Dashboard styles use only the rulebook sizes: no 14px or 20px text, spacing on the 4px grid, named corner sizes
- [x] Team app text uses named sizes (no typed-in numbers); screen titles in the serif, 700 weight only in the wordmark
- [x] Branded canvas in both apps: the four pillars woven very faintly; Overview opens with a hero (date, greeting, the shop at sunrise on the page rule)
- [x] Settings and Profile list their sections beside the page (chips on a phone)
- [x] Product page: form left, barcode and price history right, sticky Save bar
- [x] Record a sale, Count a drawer and Add an expense open in a side panel instead of sitting in the middle of the list pages
- [x] Reports split into tabs (Daily & weekly, Analytics, Team, Profit, Downloads); the period carries across
- [x] You look it over locally and say yes, then merge and push

## Logic gaps (DESIGN.md 13, items 1-6)

- [x] Menu names match page titles (Stock, Sales, Day, Reports), tabs name the views
- [x] One list of what needs you (To do), worked out from the shop's state, clears itself; badge, Inbox, Overview and team Home all use it; alerts become Updates that never count
- [x] Day page: one date with the close-the-day checklist, drawer counts, carwash and expenses; steps defined once on the server and read by both apps
- [x] End your shift: steps show done / to do and each open one opens its step
- [ ] Sales history lists checkouts; a sale opens to show its lines
- [x] Team app tabs Home, Products, Sell, Account; Favourites is a filter on Products; Home has "Something happened"
- [ ] Checks, screenshots at 375 and 1440, then you look it over before merge

## Optional

- [ ] Link from a product to the supplier you usually buy it from
