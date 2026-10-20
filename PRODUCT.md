# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

One React web app, the dashboard, used on the shop computer, on phones in the
browser, and on the shop PC inside the 4VD for Windows app (Electron), which runs
the Counter and talks to the fiscal printer. Employees get a phone-style layout of
the same app. The old Expo team app was retired on 2026-10-20.

## Users

- **The main operator (the owner's son, who built the app).** Runs the shop's
  stock, sales, team and reports day to day. Needs every capability, on both the
  shop computer and a phone. Most dashboard use is theirs.
- **The owner (the operator's father).** Legally owns the business but does not run the
  computer side. Needs to see how the shop is doing and approve things without
  learning the whole tool.
- **Family members (e.g. a younger brother).** Help in the shop with lighter,
  limited roles.
- **Employees.** Sell at the Counter and use the phone-style layout: look up
  prices and stock, report returns, damage and counts for approval, end the shift.
- **The accountant.** Files the VAT returns and keeps the books. Sees only the
  money side (VAT, sales and purchase books, books, statements).

## Product Purpose

4VD runs the Dacaj family shop and its carwashes: products, prices and barcodes,
stock, counts and expiry dates, sales, returns and numbered invoices (with VAT),
customer tabs, suppliers with orders and bills, the till (Counter) with fiscal
receipts, the daily cash check, carwash takings and expenses, money places and
bank statements, the books and VAT returns, a close-the-day checklist, approvals,
promotions, people, and reports, with alerts, daily and weekly emails so nothing slips. Success is the family spending less
time on paperwork and never being surprised by empty shelves or missing stock.
It replaces TREFIN, the till and accounting program the shop used before.

## Positioning

Built for one real family shop by the family itself, around how they actually
work (approvals from the owner, a scanner-first till, the counter as the main scene).
It may later be offered to other small shops as a product, so features are kept
general enough for that, but the shop comes first whenever the two conflict.

## Operating Context

- The shop counter and back office: the shop PC runs the Counter in the Windows
  app; the dashboard is on the shop computer and on phones for staff and for the
  operator when away.
- Staff record sales between customers, so speed and big touch targets matter.
- The day ends with a checklist: drawers counted, carwash takings entered,
  expenses added (or marked as none), requests answered. Nothing gets locked.
- Approvals flow from employees to the operator or owner, through To do.
- A daily summary alert and a Monday weekly report email keep the owner informed.

## Capabilities and Constraints

- Roles: **developer** (the operator: everything, and the only one who hands
  out the top roles), **owner** (sees everything and decides requests, changes
  nothing else), **admin** (runs the shop), **employee**, **family**,
  **accountant** (money side only). The developer can change what each role may
  do in Settings → Roles.
- Languages: **English and Albanian**, in the app, on invoices and in the emails. Each
  person's choice is saved on their account.
- Money in euros; shop time zone is configurable (Europe/Budapest by default).
- AI helpers (Ask, price suggestions) use Claude; staff names are masked first.
- Deployed on Render (API at api.4vd.app, with weekly backups to Cloudflare R2)
  and Cloudflare (dashboard at dashboard.4vd.app). app.4vd.app still serves the
  retired team app, and printed QR labels point there.
- The shop is VAT-registered. The Counter prints legal receipts on the shop's
  Datecs FP-700+ fiscal printer (through F-Link); 4VD also prints A4 invoices
  and labels.
- Currently holds test data only; at launch it is wiped and TREFIN's history is
  imported (`npm run import:trefin`).

## Brand Commitments

- Name: **4VD**, "4 Vëllezërit Dacaj", the four Dacaj brothers, named by their
  father. The mark is four equal pillars under one roof. The story is there for
  people who ask, not told in the interface.
- Visual direction: calm and tactile, "modern frame, vintage finish" (clean
  paper on faintly cool greys, one amber, serif page titles, buttons that press
  like keys, the shop at sunrise),
  learned from Cloudflare's structure, the SBB design system's rigour and
  anthropic.com's finish. All rules live in `DESIGN.md`, the single rulebook.
- Voice: plain, friendly, short. Sentence case. Buttons say what they do.

## Evidence on Hand

- Logo and icons: `brand/` (SVG and generated PNGs).
- Real product data exists only as test data; there are no customers,
  testimonials or figures to quote. Do not invent any.

## Product Principles

1. The counter comes first: the commonest jobs (record a sale, check stock,
   approve a request) take the fewest steps on any device.
2. Show as little as possible and as much as necessary (SBB "reduced").
3. Nothing touches stock or money without a clear record and, where it matters,
   the owner's approval.
4. Speak the family's language: plain words, English and Albanian.
5. Keep it general enough to sell later, without making the shop pay for it now.

## Accessibility & Inclusion

- Text and controls meet WCAG AA contrast in light and dark themes (checked by a
  test in `admin/src/theme/contrast.test.ts`).
- Touch targets at least 44px on phones; keyboard use and visible focus on desktop.
- Reduced motion is respected everywhere.
- Users of different ages and computer comfort (the owner is not a computer user).
