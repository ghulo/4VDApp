# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The dashboard is a React web app (also used on phones in the browser). The team
app is an Expo React Native app that ships to phones and also runs as a website;
its design follows the dashboard's tokens rather than iOS or Android conventions.

## Users

- **The main operator (the owner's son, who built the app).** Runs the shop's
  stock, sales, team and reports day to day. Needs every capability, on both the
  shop computer and his phone. Most dashboard use is his.
- **The owner (his father).** Legally owns the business but does not run the
  computer side. Needs to see how the shop is doing and approve things without
  learning the whole tool.
- **Family members (e.g. a younger brother).** Help in the shop with lighter,
  limited roles.
- **Employees.** Use the team app at the counter: record sales, look up prices
  and stock, report returns, damage and counts for approval.

## Product Purpose

4VD runs the Dacaj family shop: products and prices, stock and reorder levels,
sales and returns, stock counts, approvals, promotions, people, and reports, with
alerts and a weekly email so nothing slips. Success is the family spending less
time on paperwork and never being surprised by empty shelves or missing stock.

## Positioning

Built for one real family shop by the family itself, around how they actually
work (approvals from the owner, staff on phones, the counter as the main scene).
It may later be offered to other small shops as a product, so features are kept
general enough for that, but the shop comes first whenever the two conflict.

## Operating Context

- The shop counter and back office: a shop computer for the dashboard, phones for
  staff and for the operator when away.
- Staff record sales between customers, so speed and big touch targets matter.
- Approvals flow from employees (phone) to the operator or owner (dashboard).
- A daily summary alert and a Monday weekly report email keep the owner informed.

## Capabilities and Constraints

- Roles: **developer** (the operator: everything, and the only one who hands
  out the top roles), **owner** (sees everything and decides requests, changes
  nothing else), **admin** (runs the shop), **employee**, **family**.
- Languages: **English and Albanian** are both required (not built yet; the
  interface is English only today).
- Money in euros; shop time zone is configurable (Europe/Budapest by default).
- AI helpers (Ask, price suggestions) use Claude; staff names are masked first.
- Deployed on Render (API, dashboard, team app); a custom domain is pending.
- Currently holds test data only; it is wiped at launch on the real domain.

## Brand Commitments

- Name: **4VD**, "4 Vëllezërit Dacaj", the four Dacaj brothers, named by their
  father. The mark is four equal pillars under one roof. The story is there for
  people who ask, not told in the interface.
- Visual references the operator made binding: **Cloudflare's** interface
  language (rich orange on warm neutrals, halftones, dotted drawings, hairline
  frames, subtle glow and transitions) and the **SBB design system's** rigour
  (UX principles, writing rules, responsive spacing, touch sizes).
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
