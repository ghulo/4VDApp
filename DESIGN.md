---
name: 4VD
description: The Dacaj family shop's stock, sales, money and team in two calm, precise apps; ink on ivory paper with oat panels, one clay brand colour, tactile keys and the shop at sunrise.
colors:
  clay: "#d4704f"
  clay-hover: "#df8667"
  clay-edge: "#a8482a"
  clay-text: "#a8482a"
  clay-tint: "rgb(217 119 87 / 0.14)"
  pillar-ink: "#1c0f08"
  ivory-canvas: "#f0eee6"
  paper: "#faf9f5"
  sunk-paper: "#e8e4da"
  oat: "#e3dacc"
  ink: "#141413"
  ink-muted: "#5e5d59"
  hairline: "#e0dbcf"
  hairline-strong: "#cbc3b3"
  ok: "#2f6b3f"
  ok-soft: "#e7efe3"
  warn: "#86500c"
  warn-soft: "#f6ecd9"
  danger: "#b0302a"
  danger-soft: "#f8e5e1"
  info: "#3d5670"
  info-soft: "#e6ebf0"
  focus: "#141413"
  night-canvas: "#191817"
  night-paper: "#262624"
  night-sunk: "#151413"
  night-oat: "#30302e"
  night-ink: "#faf9f5"
  night-muted: "#a6a39b"
  night-hairline: "#2f2e2b"
  night-hairline-strong: "#3e3d39"
  night-clay-text: "#e08a6b"
  night-clay-edge: "#9a4024"
  night-ok: "#86c08f"
  night-ok-soft: "#1f3022"
  night-warn: "#e0a85a"
  night-warn-soft: "#3a2e19"
  night-danger: "#f39a8f"
  night-danger-soft: "#3d201c"
  night-info: "#9fb4cc"
  night-info-soft: "#222b35"
  night-focus: "#faf9f5"
typography:
  headline:
    fontFamily: "Source Serif 4, Georgia, Times New Roman, serif"
    fontSize: "2rem"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  display:
    fontFamily: "Source Serif 4, Georgia, Times New Roman, serif"
    fontSize: "clamp(1.75rem, 3.2vw, 2.25rem)"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  figure:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  title:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.4
  caption:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
  spec:
    fontFamily: "ui-monospace, SF Mono, Cascadia Mono, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.06em"
rounded:
  stamp: "3px"
  segment: "6px"
  control: "8px"
  card: "16px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
components:
  button-primary:
    backgroundColor: "{colors.clay}"
    textColor: "{colors.pillar-ink}"
    rounded: "{rounded.control}"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "36px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "36px"
  card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.card}"
    padding: "16px 24px 24px"
  nav-item-current:
    backgroundColor: "{colors.clay-tint}"
    textColor: "{colors.clay-text}"
  count-badge:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
---

# 4VD Rulebook

This is the single rulebook for how 4VD works, reads and looks, in **both apps**.
It covers the product logic (what goes where and why), the words, and the visual
design. `PRODUCT.md` says who the users are; `brand/README.md` covers the logo
files. Where anything else disagrees with this file, this file wins.

## 0. How to use this rulebook (read first)

- **It describes the target.** Some rules are not built yet. Section 13, "Built
  vs target", lists every known gap with the files involved. Before building on
  a rule, check it there. Never copy an existing screen as the pattern if that
  screen is listed as a gap.
- **Words in bold in the glossary (section 5) are fixed.** Use them exactly, in
  English and Albanian, in both apps. Don't invent synonyms.
- **Tokens live in code:** dashboard `admin/src/styles/tokens.css`, team app
  `mobile/src/theme.ts`. Change both together, and keep the frontmatter of this
  file in step. No hard-coded colours, sizes, radii or shadows in screens.
- **Build from the kits:** dashboard `admin/src/components/ui` (section 10),
  team app `mobile/src/components/ui.tsx`, `print.tsx`, `inputs.tsx`.
- **Every UI change** keeps both themes, both languages (EN and SQ catalogues in
  `admin/src/i18n` and `mobile/src/i18n`), and all states (section 9).
- **After a big feature:** screenshot at 375px and 1440px, light and dark, then
  run the accessibility and web-guidelines passes (see `CLAUDE.md`).
- **Changing a rule:** agree it with the owner in chat, then edit this file in
  the same change as the code. Remove a gap from section 13 when it is closed.

## 1. What 4VD is

Two apps for one family shop and its carwashes (4VD = "4 Vëllezërit Dacaj", the
four Dacaj brothers):

| | **Dashboard** (`dashboard.4vd.app`) | **Team app** (`app.4vd.app`, phones) |
|---|---|---|
| Who | the operator, the owner, admins | employees and family at the counter |
| Job | run the shop: stock, buying, money, people, decisions, reports | sell, look up, report what happened, close the shift |
| Scene | shop computer in the morning, phone when away | phone in one hand, a customer waiting |
| Tech | React + plain CSS on tokens | Expo React Native, also runs as a website |

They are one product with one language and one look. A person who uses both must
never wonder whether two words, colours or buttons mean the same thing.

## 2. Principles

1. **The counter comes first.** The commonest jobs (sell, check stock, answer a
   request) take the fewest taps on any device.
2. **Show what needs doing, then get out of the way.** One honest list of what
   needs attention; everything else is quiet.
3. **Think in moments, not database rows.** People think in a sale, a delivery, a
   day, a shift. Screens group by those moments.
4. **One word, one meaning.** Every thing has one name in each language, used
   everywhere (section 5).
5. **Nothing touches stock or money without a record**, and where it matters,
   the owner's decision. Everything can be undone or corrected; nothing locks.
6. **Calm at rest, clear when touched.** Emphasis goes to what matters most on
   the screen, never to decoration, zeros or disabled things.
7. **Modern frame, vintage finish.** Structure, data and interaction are crisp
   and modern; paper, serif, stamps and the sunrise are the finish.

## 3. How the product is organised

### 3.1 Dashboard menu

Grouped by the job at hand (`admin/src/navigation/sections.ts`). Target map:

| Group | Menu item | Opens | Tabs on that page |
|---|---|---|---|
| Today | **Overview** | `/` | – |
| | **Inbox** (badge) | `/inbox` | To do · Updates |
| | **Ask** | `/ask` | – |
| Sell | **Sales** | `/sales` | History · Invoices |
| | **Customers** | `/customers` | – |
| | **Promotions** | `/promotions` | – |
| Shelves | **Stock** | `/inventory` | On the shelf · Products · Categories |
| | **Counts** | `/counts` | – |
| Buy | **Suppliers** · **Orders** · **Supplier bills** | | – |
| Money | **Day** | `/day` | Close the day · Cash counts · Carwash |
| | **Expenses** | `/expenses` | – |
| | **Reports** | `/report` | Daily & weekly · Analytics |
| Team | **People** · **Activity** · **Settings** | | – |

Rules:
- **Menu label = page title.** The page a menu item opens is titled exactly like
  the item. Tabs name the views inside it and never repeat the page title.
- **Section tabs** sit above the page title. Each tab keeps its own address, so
  old links keep working. Old URLs always redirect, never 404.
- **Ctrl K** ("Search or jump to") reaches every page, tab and record.
- Settings is hidden from the owner (they see everything but change no setup).

### 3.2 Team app tabs

Target: **Home · Products · Sell · Account** (bottom bar, Sell in the middle as
the one clay key).

- **Home**: the day in one sentence, then *what's next* (section 3.3), then jobs.
- **Products**: browse and search; a **Favourites** filter chip shows the
  starred ones. There is no separate Favourites tab.
- **Sell**: the basket. Favourites first, then in-stock products as tiles.
- **Account**: profile, theme, language, alerts.

Home's jobs, in this order:
1. **Something happened**, one list of four actions: Return a sale · Damage or
   loss · Expiry date · Carwash takings. These are things that happen at the
   counter at any time, so they never hide inside other screens.
2. **End your shift** (with steps done / total).
3. **Stock count**, **Tabs**, and **Deliveries** (only while one is open).

### 3.3 What needs attention: To do vs Updates

There is **one source** of "what needs attention", shared by the Inbox badge, the
Inbox page, the Overview, the Today card and team-app Home. Two kinds of item,
never mixed:

**To do**: something someone must act on. It is *worked out from the current
state*, so it **clears itself** when the cause is gone. Nobody marks a To do as
read.
- Requests waiting for a decision (returns, damage or loss, count differences).
- Out of stock / low stock (clears when restocked).
- Expired or expiring within 7 days on the shelf.
- Supplier bills due within 7 days or overdue; tabs overdue 30 days.
- A cash difference nobody has checked yet (cleared by "Mark as checked").
- Close-the-day steps still open after 18:00.

Each To do has a severity stamp (**Urgent**, **Check**, **Idea**), a one-line
title that names the thing, one line on what to do, and **one action button**
that goes straight to fixing it.

**Updates**: things that happened, for information only: the daily summary, a
request you made was decided, a count was recorded. They have an unread dot
inside the list and **never count toward any badge**.

Rules:
- **The badge counts To do items only**, and every place that shows a "waiting"
  number shows that same number for that person.
- Zero is shown as calm words ("Nothing needs you right now"), never as "0
  waiting". Summary links with a zero count are hidden.
- Staff see the To do items that are theirs (their open shift steps, their
  requests that came back); deciders see requests.
- **Get 4VD ready** (setup steps) is separate: a slim strip on Overview, never in
  the badge.

### 3.4 The shop day and the shift

- **The day** is the shop's unit of money: one date in the shop's time zone. The
  dashboard's **Day** page shows one date: the close-the-day checklist, each
  drawer's cash count, carwash takings and expenses, with a date picker. History
  across dates lives in the Cash counts and Carwash tabs and in Reports.
- **The shift** is one person's part of the day. **End your shift** in the team
  app walks through the same steps for the places that person closes.
- The steps are defined **once** and both apps read them: cash counted per
  drawer, carwash takings per place, expenses added or "No expenses today",
  requests answered. Nothing gets locked; anything can be corrected later.
- Steps show as status (done / to do), not as checkboxes, unless tapping the row
  really ticks it. Each row that is to do is tappable and opens that step.

### 3.5 Record moments, not rows

- **A sale is one checkout**: everything a customer bought at once, with its
  invoice number. Sales history lists sales; a sale opens to show its **lines**.
  Returns start from the sale.
- **A delivery** is one order received; a **day** is one date (3.4).
- People report **what happened** (a return, damage, an expiry, takings), not
  "edit stock". Stock changes are the result, recorded with who and why.

### 3.6 Requests, decisions and undo

- Staff send **requests** (returns, damage or loss, counts that differ). The
  owner or an admin **approves** or **rejects**; the request's To do clears for
  everyone the moment it is decided.
- Most actions offer **Undo** for a short time, then stay correctable from
  their record. Destructive actions say exactly what will happen.

### 3.7 Connected records

- Supplier and customer pages are **hubs**: everything about them on one page
  (orders, deliveries, bills, owed / purchases, tab, invoices, returns).
- Every record links to its neighbours (bill → order → supplier; invoice → sale →
  customer). Work moves forward: receive a delivery → add its bill → due date.
- Pre-fill from context (`?supplier=`) so a link from a hub starts the next step.

### 3.8 Page anatomy (dashboard)

Every page starts with the shared **PageHeader**: breadcrumb (detail pages) or
section tabs (tab groups), serif title, one-line description (max 68ch),
actions on the right with **at most one primary**. No page invents its own title
block. Then one of these shapes:

- **List page**: header (primary "Add …" / "New …") → toolbar (search,
  filters) → table → pagination. **No create form on top of a list.** Adding
  opens a form page (or a panel for a few fields).
- **Detail / hub page**: header with breadcrumb and status stamp → a stat row →
  sections of related records, each a heading plus a table.
- **Form page**: grouped cards up to 720px wide; a **footer bar** with the
  primary action on the right and Cancel to its left; the save result on the
  left. Same placement on every form.
- **Settings**: setting rows (what it is on the left, control on the right).
- **Report page**: the only dense page: metric grid, charts, tables.
- **Overview**: the morning page. Order: header → **To do** list (largest,
  first) → the Today strip (the day in one serif sentence, the 30-day bars, a
  small sunrise) → Get 4VD ready (while unfinished) → Needs restocking → link
  to Reports.

The team app follows the same ideas on a phone: a serif title, one primary
action, a full-width primary key at the bottom of forms.

## 4. Voice

- Plain, friendly, short. Sentence case. The owner is not a computer person.
- Buttons are 1–4 words, start with a verb or name the destination.
- Errors say what happened and how to fix it. Empty states say what will show
  up here and how to make it happen.
- Don't tell the four-brothers story in the interface.
- English is **British English** (favourite, colour, catalogue). Every string
  exists in English and Albanian; no hard-coded text (tests enforce it).

## 5. Glossary (fixed words)

New Albanian wording marked *(confirm)* needs the owner's check before shipping.

| Thing | English | Albanian | Never say |
|---|---|---|---|
| The web app for running the shop | **dashboard** | **paneli** | website, admin, back office |
| The phone app for staff | **team app** | **aplikacioni i ekipit** | mobile app |
| Something the shop sells | **product** | **produkt** | item, article |
| How many are on the shelf | **stock** | **stoku** | inventory |
| The page of stock levels | **On the shelf** | **Në raft** | |
| A product you starred | **favourite** (star icon); action **Add to favourites** | **favorit**; **Shto te favoritet** *(confirm)* | pin, save to favourites, favorite |
| The place where you sell | **Sell** (tab, title, opening button) | **Shit** | Record a sale (as a title) |
| Finishing a sale | **Record sale · €X** | **Regjistro shitjen · €X** *(confirm)* | Checkout |
| One customer's purchase | **sale** | **shitje** | transaction |
| One product within a sale | **line** | **rresht** | |
| What is being built before recording | **basket** | **shporta** *(confirm)* | cart |
| Numbered A4 document for a sale | **invoice** | **faturë** | receipt (the fiscal printer does receipts) |
| A supplier's invoice to the shop | **supplier bill** | **fatura e furnitorit** | |
| What a customer owes | **tab** | **borxh** | credit, debt |
| Someone you sell to | **customer** | **klient** | client |
| Counting a drawer's money | **cash count**; action **Count the drawer** | **numërimi i arkës**; **Numëro arkën** *(confirm)* | cash check, close the drawer |
| Money a drawer starts with | **float** | (keep current SQ) | |
| The shop's end-of-day steps | **Close the day** | **Mbyll ditën** *(confirm)* | Z report |
| One person's end-of-day steps | **End your shift** | **Mbyll turnin** | |
| Broken, lost or stolen stock | **damage or loss** | **dëmtim ose humbje** | write-off (except in accountant exports) |
| Counting the shelves | **stock count** | **numërim stoku** | inventory check |
| Goods arriving from a supplier | **delivery** | **furnizim** | |
| What the shop asks a supplier for | **order** | **porosi** | purchase order |
| Something staff ask the owner | **request**; **Approve** / **Reject** | **kërkesë**; **Mirato** / **Refuzo** | |
| Needs someone to act | **To do** | **Për t'u bërë** *(confirm)* | alert, waiting |
| Happened, for information | **Updates** | **Njoftimet** | alerts |
| Who did what, when | **Activity** | **Aktiviteti** | log |
| Carwash takings | **carwash** (Lavazhi) + **change** (Këmbimi) | **Lavazhi** + **Këmbimi** | car wash |
| The person account screen | **Account** | **Llogaria** | Me, Profile (team app) |

## 6. Colour

Warm neutrals carry everything; one clay marks brand, action and place; status
colours are earthy and quiet, always with words.

### Neutrals
- **Ivory Canvas** `#f0eee6` / night `#191817`: the page.
- **Paper** `#faf9f5` / `#262624`: cards, tables, sidebar, fields.
- **Sunk Paper** `#e8e4da` / `#151413`: footer strips, row hover, callouts, search.
- **Oat** `#e3dacc` / `#30302e` (token `fill`): feature panels (Today, team-app
  job tiles), ghost hover, segmented track.
- **Ink** `#141413` / `#faf9f5`: text, data, checked switches, count badges.
- **Muted Ink** `#5e5d59` / `#a6a39b`: descriptions, labels, chart series.
- **Hairline** `#e0dbcf` / `#2f2e2b` and **Strong Hairline** `#cbc3b3` / `#3e3d39`.

### Clay (brand)
- **Clay** `#d4704f` (both themes): the logo, the sunrise, **the one primary key
  per screen**, progress toward a goal, and the current menu item's marker.
- **Clay Text** `#a8482a` / `#e08a6b` on **Clay Tint** (14% / 18%): the current
  menu item's label and fill.
- Text on clay is **Pillar Ink** `#1c0f08` (white fails contrast).

### Status (earthy, quiet)
Each has a strong colour for text and outlines, and a soft tint for washes.

| | Light | Light soft | Dark | Dark soft |
|---|---|---|---|---|
| **OK** (sage green) | `#2f6b3f` | `#e7efe3` | `#86c08f` | `#1f3022` |
| **Warn** (ochre) | `#86500c` | `#f6ecd9` | `#e0a85a` | `#3a2e19` |
| **Danger** (brick) | `#b0302a` | `#f8e5e1` | `#f39a8f` | `#3d201c` |
| **Info** (slate) | `#3d5670` | `#e6ebf0` | `#9fb4cc` | `#222b35` |

All four pass 4.5:1 on paper, canvas and oat in both themes and on their own
soft tint (checked 2026-10-10; `admin/src/theme/contrast.test.ts` must keep
passing). They replace the old bright Tailwind-style status colours, which
looked cold and generic on ivory.

### Focus
- **Focus ring = Ink** (`#141413` light, `#faf9f5` dark), 2px, offset 2px. It
  reaches 15:1 on canvas and stays visible on a clay key. There are no cool blue
  accents anywhere in the interface.

### Colour rules
- **The Clay Rule.** Clay means brand and "act here". **One clay key per
  screen** (a phone screen's bottom bar counts: if the Sell tab key is visible,
  the screen's own main action is a secondary key unless it *is* selling).
  Links, badges, charts and counts are never clay.
- **The Ink Data Rule.** Data is drawn in ink: series in Muted Ink, the active
  bar or point in Ink. Up/down changes use OK/Danger words, not just colour.
- **No second accent.** Status colours are for status only.
- **Colour never carries meaning alone**; words always do.

## 7. Type

- **Source Serif 4, 500**: page titles (Headline, 2rem), the day's sentence
  (Display), sign-in headings, empty-state titles on big pages. Never numbers,
  tables, controls or card titles.
- **Hanken Grotesk**: everything else. Body 15px (0.9375rem); Title 17px/600
  for card titles; Label 13px/600 for field labels; Caption 12px/600.
- **Spec labels**: monospace capitals, 12px, 0.06em tracking, for table headers,
  metric labels, sidebar group names, stamps and the team-app date kicker. Never
  a sentence, never a button. These are the only capitals allowed.
- **Figures**: Hanken 600, 28px (36px on a large metric card), tabular.
- **The scale is closed**: 12 / 13 / 15 / 17 / 28 / 32 px plus the display clamp.
  No 14px, no 20px one-offs. The team app has the same scale as named tokens in
  `theme.ts` (`type.caption`, `type.label`, `type.body`, `type.title`,
  `type.figure`, `type.headline`), never raw `fontSize` numbers.
- Weights: 400, 500, 600 only (700 only in the wordmark and count badges).
- In `theme.ts`, `fonts.display` means **the serif**, as on the dashboard.

## 8. Layout, surfaces and depth

### Layout
- 4px grid: 4, 8, 12, 16, 24, 32, 48.
- Dashboard: 56px top bar; 232px sidebar (60px collapsed; a drawer under 900px);
  content column max 1120px; page padding 32/48 desktop, 32/24 under 1100px,
  24/16 under 900px. Sections stack 16px apart.
- Controls 36px (30px small) on desktop, **44px (36px small) under 900px** and
  always in the team app.

### Two kinds of surface
- **Raised card** (Paper + Raise shadow, 16px corners): things you work in:
  forms, the To do list, the Today strip, setting groups, metric cards.
- **Table surface**: a DataTable is itself a framed surface. **Never put a
  table inside a card** (no box in a box): a section is a heading plus a table.
- **Flat**: page header, toolbar, history headings sit on the canvas.
- **Feature panel** (Oat + Sheen): the Today strip and team-app job tiles only.

### Depth vocabulary (the only shadows allowed)
- **Raise**: cards and panels rest just above the canvas.
- **Inset**: fields, segmented tracks, card footer strips sit into it.
- **Key**: buttons stand on a solid edge (section 10.1).
- **Float**: palette, drawer, menus and dialogs over a dimmed backdrop.
- **Glass**: floating chrome only (section 8.1).
The user dislikes flat UI: surfaces keep this depth. Never invent a shadow,
never a glow.

### 8.1 Glass (clean and purposeful)
Glass is for **chrome that floats over moving content**, so you can see the page
pass underneath. Allowed only on: the dashboard top bar, the Ctrl K palette, the
phone menu drawer, the team-app tab bar, sticky phone action bars, and the
sign-in moment cards. Never on cards, tables, forms or anything that holds
reading text at rest.

One recipe, everywhere:
- **Tint**: Paper at 72% (thin pane) or 90% (dense pane: palette, drawer).
- **Blur**: 16px with saturate 1.4. No brightness boost, no sheen gradient (they
  muddy text and make ivory look grey).
- **Edge**: one 1px Hairline on the side that meets the content (the top bar's
  bottom edge, the tab bar's top edge) and a 1px inner top highlight (white 60% /
  6% dark). No white borders on ivory, where they disappear.
- **Shadow**: none on bars; Float on panes.
- **Only when there is something behind it**: the top bar is solid canvas at
  the top of the page and turns to glass once the page scrolls under it.
- **Backdrop** behind panes: Ink at 30%, 2px blur.
- **Fallback**: solid Paper when blur is unsupported, under
  `prefers-reduced-transparency`, `prefers-contrast: more`, and on Android.
- Tokens: `--glass-bg`, `--glass-bg-strong`, `--glass-edge`, `--glass-highlight`,
  `--glass-filter`; the team app mirrors them (expo-blur on iOS and web).

## 9. States (required everywhere)

Every interactive thing has **hover, focus, pressed, disabled, loading**; every
data view has **loading, empty, error**.
- **Loading**: skeleton rows for tables and lists; a spinner inside the button
  for actions (the label stays, the button keeps its width).
- **Empty**: icon chip, a title saying what will be here, one sentence on how to
  get it, and one action. Big empty pages may show the sunrise.
- **Error**: what went wrong in plain words and a **Try again** action. Field
  errors sit under the field and say how to fix it.
- **Disabled**: explain why next to it ("Add a product to sell"). A disabled
  button is never the largest thing on a screen.

## 10. Components

### 10.1 Buttons (tactile keys, refined)
Buttons behave like keyboard keys: they stand on a solid edge and press down into
it. Refinements over the first version: thinner edge, softer drop, no lift on
hover (less jumpy in dense rows), the same recipe in both apps.

| Variant | Face | Edge | Use |
|---|---|---|---|
| **Primary** | Clay, lit from the top (linear: Clay Hover at the top to Clay at 60%) | 2px Clay Edge | the one main action per screen |
| **Secondary** | Paper with a 1px Strong Hairline ring | 2px Strong Hairline | every other action, form Cancel |
| **Ghost** | none until hover (Oat) | none | toolbars, icon buttons, menu rows |
| **Danger** | Danger with Paper text | 2px darker danger | destroying something, inside a confirm |
| **Danger text** | red words only | none | "Delete" beside other actions |

- **Rest**: face + edge + a 1px light line inside the top + a soft drop (0 2px
  6px, 10% ink).
- **Hover**: the face brightens slightly; no movement.
- **Pressed**: the face moves down 2px, the edge shrinks to 0, the drop tightens.
- **Focus**: Ink ring 2px, offset 2px (section 6).
- **Disabled**: flat (no edge, no drop), Sunk Paper face with a 1px Hairline ring
  and Muted Ink text, so it still reads as a button. Never 50% opacity.
- **Loading**: spinner replaces the icon, label stays.
- Sizes: 36px (30px small) desktop; 44px (36px small) phones. Padding 14px; icon
  16px with 6px gap; label 15px/500 (primary 600).
- **A row of actions shares one style**, apart from one primary. Never mix a
  raised key with bare text buttons in the same row.
- Width: buttons hug their label on desktop. Full width only at the bottom of a
  phone form or the team-app basket.

### 10.2 Links
Ink, underlined at 40% with a 3px offset, full underline on hover. Table title
links and breadcrumbs drop the underline until hover.

### 10.3 Fields
Paper, Strong Hairline stroke, Inset, 8px corners, 36px (44px phones), 15px text.
Label always visible above; placeholder only for an example. Focus: Ink ring as
buttons. Checked switches and checkboxes are Ink. **Dates always read
day / month / year** (a custom field, not the browser's native date input).

### 10.4 Tables (DataTable)
Every table is a `DataTable`: framed surface, optional toolbar and footer strips,
12px cells (16px at the edges), spec-label headers, hairline rows, sunk hover,
numbers right-aligned and tabular, ARIA table roles. Under 600px rows stack:
title cell first in 600 weight, then "column name: value" lines. An empty table
shows an empty state instead of headers.

### 10.5 Stamps (badges)
Like a rubber stamp: 22px, monospace capitals 11px, 0.06em, 1px outline in the
status colour, 3px corners, no fill. Tones: ok, warn, danger, info, neutral, ink.
Severity stamps: **Urgent** (danger), **Check** (warn), **Idea** (info). On
phones a stamp sits **above** its text, not in a side column.

### 10.6 Numbers, money and dates
- **Money in tables and forms**: always cents (`€1,200.00`).
- **Headline figures** (metric cards, the Today sentence) of €1,000 or more drop
  the cents (`€240,769`).
- **Changes are said in words with a number**: "38% more than September", "€120
  less than last Saturday". "Much more" alone is not allowed. If the comparison
  base is zero, say "First sales this period".
- Dates: `9 Oct 2026`; with time `9 Oct, 12:21`; weekday where it helps
  (`Sat 4 Oct`). Never month-first.
- Every number that can change in place or sit in a column is tabular.

### 10.7 Charts
- Ink rule (section 6). Bars with softly rounded tops, smooth lines over a 12%
  flat fill, hairline grid, an ink tooltip with paper text, "Show as table".
- **One outlier must not flatten the rest**: when the top value is more than 4×
  the next highest, cap the axis, draw the capped bar to the top with a break
  mark and label its real value.
- Metric cards sit on an even grid: every card in a row has the same parts (all
  with a mini graph or none). No half-empty last rows: let the last card span.

### 10.8 Stock tag
The shelf count over 10 printed blocks (both apps): full at twice the reorder
level, a wider gap after the fifth block (the reorder point), lit blocks in the
stock colour, the rest Strong Hairline.

### 10.9 Product photo
Square, 40px with 8px corners in lists, 112px with 16px in forms. With no photo,
**both apps** show the same placeholder: Sunk Paper with a Hairline ring and the
line box icon (not a letter).

### 10.10 Segmented controls
Joined options on an Oat inset track, the selected one raised on Paper. Used for
theme (Light / Dark / Auto, with icons) and language (English / Shqip) **in both
apps**, and for small view switches. Not for more than 4 options.

### 10.11 Navigation
Sidebar rows 34px (44px in the drawer): line icon + 500 label in Muted Ink;
hover Oat; current = Clay Tint fill, Clay Text label, 3px Clay marker on the edge.
Count badge: Ink pill with Paper text, To do count only (3.3).

## 11. The printed finish (vintage, used sparingly)

- **The shop at sunrise** (`admin/src/components/ui/ShopSunrise.tsx`,
  `mobile/src/components/print.tsx`): the mascot. Sign-in, team-app Home's Today
  panel, the dashboard's Today strip, big empty pages, nowhere else. It is
  **never larger than the information beside it**: up to 160px on the Today
  strip, 240px in empty states, 560px on sign-in. Hidden from screen readers;
  the sun rises once, off under reduced motion.
- **Paper grain** over the dashboard (7% light, 5% dark), off under more contrast
  and in print.
- **Rules**: a hairline under page titles; one double rule under the team app's
  masthead only.
- **Icon chips**: line icons in a 44px soft chip (Paper on Oat, Oat on Paper).
- **Block meters**: only the monthly target (20 blocks) and stock tags (10).
- **Receipt feel for the basket** (team app Sell, dashboard Sell): lines in
  tabular figures, a dashed tear line above the total, the total in Figure type.
- Never dither or texture data, icons, tables or forms.

## 12. Motion and accessibility

- Motion: 150ms, `cubic-bezier(0.16, 1, 0.3, 1)`, never bouncy; all inside
  `prefers-reduced-motion: no-preference`.
- WCAG AA contrast in both themes (contrast test). 44px touch targets on phones.
- Keyboard: every action reachable, visible focus, one tab stop per chart
  (arrows walk the data), dialogs trap focus and return it.
- Screen readers: ARIA labels match the visible words; a badge's label says what
  it counts ("3 to do").

## 13. Built vs target (known gaps, 2026-10-10)

Each item is a rule above that the code doesn't follow yet. Fix it when touching
that area; remove it from this list when done.

**Logic and structure**
1. **One attention source.** Badge = approvals + unread alerts
   (`admin/src/components/Layout.tsx`); stock and info alerts never clear
   themselves (only decided requests do, `NotificationRepository.markSubjectRead`).
   Overview attention, Today card and team Home each compute their own. → 3.3
2. **Menu names.** "Products" opens a page titled "Stock"; "Cash & carwash"
   opens "Cash check"; tab "Sales" under "Sales". → 3.1 (`sections.ts`, i18n).
3. **Day page.** The close-the-day checklist lives on the Cash check page
   (`CashPage.tsx`, `DayChecklist.tsx`); no Day page yet. Steps are defined
   separately in each app (`mobile/src/utils/shift.ts`). → 3.4
4. **Sales by checkout.** Sales history lists lines; the Sell form sits on top of
   the Sales list (`SalesPage.tsx`). → 3.5, 3.8
5. **Team tabs.** Favourites is its own tab (`RootNavigator.tsx`); no
   "Something happened" on Home; return / damage / expiry / carwash only reachable
   from My sales, product pages or End your shift. → 3.2
6. **End your shift** shows empty checkboxes that aren't tappable
   (`EndShiftScreen.tsx`); long place names wrap badly. → 3.4
7. **Create forms on list pages** (Cash check, Expenses, Sales). → 3.8

**Words** (→ section 5)

8. "Favorites" / "favourite" / "pin" / "Save to favorites"; "Record a sale" as
   the Sell title; "Close the drawer"; "Cash check"; "mobile app"; "4VD website"
   in the role description; "write-off" in staff-facing text.

**Look**

9. **Overview hierarchy**: Today panel ~1/3 of the screen, zero counts shown,
    stamps in a side column on phones, "Hi Admin" title. → 3.8, 10.5
10. **Reports**: cents on headline figures, "Much more", sparklines flattened by
    one outlier, ragged metric grid (`ReportsPage.tsx`, `MetricCard.tsx`). → 10.6–10.7
11. **Tables not on DataTable** (miss the ARIA fix): SalesPage, PromotionsPage,
    OrdersPage (2), StockCountDetailPage, ProductFormPage, ReportsPage (2). → 10.4
12. **Off-scale values** in `admin/src/styles/pages.css`: 13 × 14px text, ~108
    raw px spacings, radii 2/4/6/10/12/14px, weights 300/700. → 7, 8
13. **Team app type**: no type tokens (19 raw `fontSize` values);
    `fonts.display` is the sans. → 7
14. **Native date inputs** show mm/dd/yyyy in English browsers. → 10.3
15. **Mismatched pieces between apps**: no-photo placeholder (letter vs icon),
    theme / language controls (chips vs segmented). → 10.9, 10.10
16. **Box in a box**: tables inside cards (Sales history, Cash counts, others). → 8
17. **Two clay keys** on team Home ("Record a sale" + Sell tab). → 6
18. **Sell screens** look plain: little product grid, no receipt-style basket. → 11
