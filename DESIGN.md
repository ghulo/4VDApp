---
name: 4VD
description: The Dacaj family shop's stock, sales, money and team in two calm, precise apps; ink on clean paper, one amber brand colour on matched colour scales, tactile keys and the shop at sunrise.
colors:
  amber: "#f5b71a"
  amber-hover: "#ffd073"
  amber-edge: "#a37801"
  amber-text: "#745504"
  amber-tint: "rgb(245 183 26 / 0.16)"
  pillar-ink: "#0d1012"
  ivory-canvas: "#edf1f3"
  paper: "#f5f9fb"
  sunk-paper: "#e1e5e7"
  oat: "#d4d8da"
  ink: "#16191B"
  ink-muted: "#585b5e"
  hairline: "#e1e5e7"
  hairline-strong: "#d4d8da"
  ok: "#386743"
  ok-soft: "#e2f7e5"
  warn: "#894529"
  warn-soft: "#feece5"
  danger: "#8d3e47"
  danger-soft: "#feebeb"
  info: "#3e5e7e"
  info-soft: "#e6f2ff"
  focus: "#745504"
  night-canvas: "#0d1012"
  night-paper: "#16191B"
  night-sunk: "#050809"
  night-oat: "#2b2e30"
  night-ink: "#f5f9fb"
  night-muted: "#bbbec0"
  night-hairline: "#2b2e30"
  night-hairline-strong: "#424648"
  night-amber-text: "#f5b71a"
  night-amber-edge: "#a37801"
  night-ok: "#99cda3"
  night-ok-soft: "#253127"
  night-warn: "#f8a788"
  night-warn-soft: "#3c2821"
  night-danger: "#fda0a7"
  night-danger-soft: "#3d2728"
  night-info: "#9dc2e9"
  night-info-soft: "#262f38"
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
    backgroundColor: "{colors.amber}"
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
    backgroundColor: "{colors.amber-tint}"
    textColor: "{colors.amber-text}"
  count-badge:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
---

# 4VD Rulebook

This is the single rulebook for how 4VD works, reads and looks.
It covers the product logic (what goes where and why), the words, and the visual
design. `PRODUCT.md` says who the users are; `brand/README.md` covers the logo
files. Where anything else disagrees with this file, this file wins.

## 0. How to use this rulebook (read first)

- **It describes the target.** Some rules are not built yet. Section 13, "Built
  vs target", lists every known gap with the files involved. Before building on
  a rule, check it there. Never copy an existing screen as the pattern if that
  screen is listed as a gap.
- **Words in bold in the glossary (section 5) are fixed.** Use them exactly, in
  English and Albanian, everywhere. Don't invent synonyms.
- **Tokens live in code:** `admin/src/styles/tokens.css`. Keep the frontmatter
  of this file in step. No hard-coded colours, sizes, radii or shadows in screens.
- **Build from the kit:** `admin/src/components/ui` (section 10).
- **Every UI change** keeps both themes, both languages (EN and SQ catalogues in
  `admin/src/i18n`), and all states (section 9).
- **After a big feature:** run lint:ui (375px and 1440px, light and dark) and
  the accessibility and web-guidelines passes (see `CLAUDE.md`).
- **Changing a rule:** agree it with the owner in chat, then edit this file in
  the same change as the code. Remove a gap from section 13 when it is closed.

## 1. What 4VD is

One app, the **dashboard** (`4vd.app`), for one family shop and its
carwashes (4VD = "4 Vëllezërit Dacaj", the four Dacaj brothers). It shows each
person the layout that fits their job:

| | **Full dashboard** | **Staff layout** (phone-style) | **Counter** (`/counter`) |
|---|---|---|---|
| Who | the developer, the owner, admins, the accountant (money side only) | employees and family | whoever is at the till |
| Job | run the shop: stock, buying, money, books, people, decisions, reports | sell, look up, report what happened, close the shift | sell fast with a scanner and print the fiscal receipt |
| Scene | shop computer in the morning, phone when away | phone in one hand, a customer waiting | the shop PC, in the Windows app (`desktop/`) |

Tech: React + Vite with plain CSS on tokens. The old Expo team app (`mobile/`,
`app.4vd.app`) was retired on 2026-10-20; its features live in the staff layout.

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
   the owner's decision. Everything can be undone or corrected; nothing locks,
   except a VAT month once it is **filed**: then nothing dated in it changes
   until the accountant or the owner reopens it with a reason (kept in Activity).
   A late supplier bill still goes in; its VAT counts in the next open month.
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
| | **Counter** | `/counter` | – (full screen, outside the menu frame; employees see only this page) |
| Shelves | **Stock** | `/inventory` | On the shelf · Products · Categories |
| | **Counts** | `/counts` | – |
| Buy | **Suppliers** | `/suppliers` | All suppliers · Orders · Bills (Bills holds Scan a bill and the scan check page, `/bills/scans/:id`) |
| Money | **Day** | `/day` | Close the day · Cash counts · Carwash |
| | **Expenses** | `/expenses` | – |
| | **Reports** | `/report` | Daily & weekly · Analytics · Counter (what each person did at the till) |
| | **Money** (managers, the owner and the accountant) | `/money` | Every place money is kept; a place opens its book, `/money/:id`; a bank account also has **Bank statement**, `/money/:id/statement` |
| | **Books** (managers, the owner and the accountant) | `/books` | Balances · Entries · Accounts · VAT · Sales book · Purchase book (an account opens its card, `/books/accounts/:id`; VAT is `/books/vat`, the books `/books/sales-book` and `/books/purchase-book`) |
| Team | **People** · **Activity** · **Settings** | | – (Settings has a **Counter** section: printer, receipt footer, tax groups, drawer key) |

Rules:
- **Menu label = page title.** The page a menu item opens is titled exactly like
  the item. Tabs name the views inside it and never repeat the page title.
- **Section tabs** sit above the page title. Each tab keeps its own address, so
  old links keep working. Old URLs always redirect, never 404.
- **Ctrl K** ("Search or jump to") reaches every page, tab and record.
- Settings is hidden from the owner (they see everything but change no setup).
- The **accountant** sees only the money side: Inbox, Sales (read only),
  Customers, Suppliers, Expenses, Reports and Books. They land on VAT. The team
  app turns them away at sign-in.

### 3.2 Staff layout tabs

Employees get `StaffLayout` (`admin/src/components/StaffLayout.tsx`,
`admin/src/navigation/staff.ts`): **Home · Products · Sell · Account** in a
bottom bar, Sell (the Counter) as the one amber key. No books, costs or settings.

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
Inbox page, the Overview, the Today card and the staff Home. Two kinds of item,
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
- **The badge counts To do items only** (Urgent and Check; Ideas wait in the
  list without adding to any number), and every place that shows a "waiting"
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
- **The shift** is one person's part of the day. **End your shift** in the staff
  layout walks through the same steps for the places that person closes.
- The steps are defined **once** on the server and every page reads them: cash counted per
  drawer, carwash takings per place, expenses added or "No expenses today",
  requests answered. Nothing gets locked; anything can be corrected later.
- Steps show as status (done / to do), not as checkboxes, unless tapping the row
  really ticks it. Each row that is to do is tappable and opens that step.

### 3.5 Record moments, not rows

- **A sale is one checkout**: everything a customer bought at once, with its
  invoice number. Sales history lists sales; a sale opens to show its **lines**.
  Returns start from the sale.
- **A delivery** is one order received; a **day** is one date (3.4).
- **Activity speaks the reader's language.** A log entry is stored as a sentence
  key with its facts (`summary_say`), and each reader sees it in their own
  language at read time. A new kind of entry adds its sentence in English and
  Albanian to `backend/src/i18n/activityText.ts`, never a ready-made string.
- People report **what happened** (a return, damage, an expiry, takings), not
  "edit stock". Stock changes are the result, recorded with who and why.

### 3.6 Requests, decisions and undo

- Staff send **requests** (returns, damage or loss, counts that differ). The
  owner or an admin **approves** or **rejects**; the request's To do clears for
  everyone the moment it is decided.
- Most actions offer **Undo** for a short time, then stay correctable from
  their record. Destructive actions say exactly what will happen.
- **Every record keeps a history.** Each detail page (product, bill, order,
  supplier, customer, invoice, scanned bill, the shop in Settings) ends with a
  **History** card: who changed what and when, read from the activity log,
  undos included and nothing editable. An invoice's history includes its
  sales, their returns and its credit notes. Any new edit must write a log
  entry, with `{ field: { from, to } }` or `fields: [{ field, from, to }]` details.
- The **developer** can take back what others can't: a confirmed scanned bill
  is reopened (stock, bill, order, costs, barcodes and codes put back) and
  checked again.

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
block. Every page uses the same frame: up to 1600px wide (`--frame-wide`),
a slim header (16px under it, 12px padding, 15px description) and ledger rows
in every table, so the frame never jumps between pages. Text inside keeps its
own reading width (descriptions 68ch, card hints 60ch). Then one of these shapes:

- **List page**: header (primary "Add …" / "New …") → toolbar (search,
  filters) → table → pagination. **No create form on top of a list.** Adding
  opens a form page (or a panel for a few fields).
- **Work page** (a list page you work through: Books, Sales, Stock, Bills,
  Expenses, Customers, Suppliers, Activity…). Figures, if any, are a slim strip (`StatGrid compact`). **One command bar**:
  the table's toolbar holds the period (`PeriodPicker compact`), search and
  filters on the left and downloads in `.toolbar__end` on the right; several
  downloads share one `MenuButton`. Money columns end in a **totals row**
  (`DataTable totals`). A record that would otherwise open in a Sheet opens
  in an `Inspector`: docked beside the list from 1440px (the row stays marked
  with the amber bar), a Sheet below that. Rows that lead to a detail page with
  its own work (a bill, an invoice, a product) stay links; a preview would only
  repeat that page. The header's actions keep only the
  primary action and Edit. Where a period also scopes figures above the table
  (Sales, Reports), the period stays on its own row of chips.
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

The staff layout follows the same ideas on a phone: a serif title, one primary
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
| Something the shop sells | **product** | **produkt** | item, article |
| How many are on the shelf | **stock** | **stoku** | inventory |
| The page of stock levels | **On the shelf** | **Në raft** | |
| A product you starred | **favourite** (star icon); action **Add to favourites** | **favorit**; **Shto te favoritet** *(confirm)* | pin, save to favourites, favorite |
| The place where you sell | **Sell** (tab, title, opening button) | **Shit** | Record a sale (as a title) |
| The full-screen till on the shop PC | **Counter** | **Arka** | POS, register, checkout |
| What the fiscal printer prints for a sale | **receipt** | **kupon** | invoice (that is the numbered A4 document) |
| The printer's running and closing totals | **X report** · **Z report** (Counter keys only) | **Raporti X** · **Raporti Z** | Close the day (that is the shop's own steps) |
| Giving money back for a returned line | **refund** | **kthim** | return receipt, storno |
| Seeing a price at the Counter without selling | **Price check** (F10) | **Kontrollo çmimin** (key: **Shiko çmimin**) | price lookup, PLU |
| One rabat on every line of a basket | **Basket rabat** | **Rabat i shportës** | discount, cart discount |
| Part of a sale on the card terminal, the rest in cash | **Cash + card** (the card part: **On the card**) | **Kesh + kartelë** (**Me kartelë**) | split payment, mixed tender |
| The printer's small screen facing the buyer | **Customer display** | **Ekrani për klientin** | pole display, VFD |
| The beep and buzz after a scan | **Scan sounds** | **Tingujt e skanimit** | audio feedback |
| How a product is sold: whole pieces, or weighed with a kilo price | **Sold by** (**The piece** / **The kilo (weighed)**) | **Shitet me** (**Copë** / **Kilogram (peshohet)**) | unit of measure, UoM |
| The product's number in the shop scale, printed in its labels | **Scale number** | **Numri në peshore** | PLU |
| A buyer the Counter doesn't know | **Walk-in customer** | **Klient pa emër** | anonymous, guest |
| Finishing a sale | **Record sale · €X** | **Regjistro shitjen · €X** *(confirm)* | Checkout |
| One customer's purchase | **sale** | **shitje** | transaction |
| One product within a sale | **line** | **rresht** | |
| What is being built before recording | **basket** | **shporta** *(confirm)* | cart |
| Numbered A4 document for a sale | **invoice** | **faturë** | receipt (the fiscal printer does receipts) |
| A supplier's invoice to the shop | **supplier bill** | **fatura e furnitorit** | |
| What one line of a supplier bill is | **Product** (into stock) · **Cost** (a category) · **Equipment** (what the business owns) | **Produkt** · **Shpenzim** · **Pajisje** *(confirm)* | bill type, item type, fixed asset |
| When a supplier bill is paid | **Pay later** · **Paid now** (an expense is a bill paid now) | **Paguaj më vonë** · **Paguar tani** *(confirm)* | cash bill, expense bill |
| Goods sent back, or a lower price agreed after the bill | **Return or credit** (stamps **Return** / **Credit**) | **Kthim ose zbritje** (**Kthim** / **Zbritje**) *(confirm)* | credit note (except the supplier's own document number), debit note |
| Tax the shop keeps back and pays to ATK itself | **tax held back** | **tatim i mbajtur** *(confirm)* | withholding, WR |
| A supplier based outside Kosovo | **abroad** | **jashtë vendit** *(confirm)* | reverse charge, self-charged VAT, foreign |
| What the customs paper shows | **customs**: **VAT paid at customs** and **duty** | **dogana**: **TVSH e paguar në doganë** and **taksa doganore** *(confirm)* | landed cost, import declaration |
| When a bill raises a product's cost | **Costs went up** (with the margin and a new shelf price) | **Kostot u rritën** *(confirm)* | price variance |
| What a customer owes | **tab** | **borxh** | credit, debt |
| Someone you sell to | **customer** | **klient** | client |
| Counting a drawer's money | **cash count**; action **Count the drawer** | **numërimi i arkës**; **Numëro arkën** *(confirm)* | cash check, close the drawer |
| Money a drawer starts with | **float** | (keep current SQ) | |
| The cash counted into the drawer before the first sale (the day's real float) | **Opening cash** | **Keshi i fillimit** | opening float, starting balance |
| What the shop drawer should have in it now (overseers only) | **The drawer should hold** | **Arka duhet të ketë** | expected cash, theoretical balance |
| A person's 4-6 digit number, only for the Counter | **Counter PIN** | **PIN-i i arkës** | passcode, operator code |
| Handing the till to someone else with their PIN | **Switch person** | **Ndrro personin** | change cashier, operator login |
| A sale made without internet, kept on the PC until it is sent | **Waiting to send** | **Pret të dërgohet** | offline queue, pending sync |
| An owner's PIN allowing a rabat over the limit, once | **Ask the owner** (they press **Allow**) | **Pyet pronarin** (**Lejo**) | manager override, supervisor approval |
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
| The person account screen | **Account** | **Llogaria** | Me, Profile |
| The shop's accounting | **Books** | **Librat** *(confirm)* | ledger, accounting |
| One record in the books | **entry** | **regjistrim** *(confirm)* | journal entry, posting, voucher |
| The two sides of an entry | **Debit** / **Credit** (short **Dr** / **Cr**) | **Debi** / **Kredi** (short **D** / **K**) *(confirm)* | |
| The list of the shop's accounts | **chart of accounts** (page **Accounts**) | **plani kontabël** (page **Llogaritë**) *(confirm)* | |
| What each account held in a period | **trial balance** (page **Balances**) | **bilanci** *(confirm)* | |
| Every movement on one account | **account card** | **kartela** *(confirm)* | ledger card |
| One month's VAT figures for ATK | **VAT return** (page **VAT**) | **deklarata e TVSH-së** (page **TVSH**) *(confirm)* | tax form, TV form |
| A month sent to ATK and locked | **filed** (stamp **Filed**); action **Mark as filed** · **Reopen** | **deklaruar** (**Deklaruar**); **Shëno si të deklaruar** · **Rihap** *(confirm)* | closed, submitted |
| Every sale or purchase of a month, in ATK's columns | **sales book** · **purchase book** | **libri i shitjes** · **libri i blerjes** *(confirm)* | ledger, register |
| A till, the safe or a bank account | **place** (page **Money**) | **vend** (page **Paratë**) *(confirm)* | account, wallet, cash box |
| Money from one place to another, or the owner's | **Move money** | **Lëviz para** *(confirm)* | transfer, deposit, withdrawal |
| The bank's list of what came in and went out | **bank statement** | **ekstrakt i bankës** *(confirm)* | bank feed, export |
| Saying what a statement line is | **match** · **Confirm** · **Leave it out** · **Take the match back** | **përputh** · **Konfirmo** · **Lëre jashtë** · **Ktheje përputhjen** *(confirm)* | reconcile |
| Words that make a line the same thing every time | **rule** | **rregull** | bank rule |
| Records brought over from the old program, look-only | small **TREFIN** tag (neutral badge); filter **4VD and TREFIN · 4VD only · TREFIN only**; a whole TREFIN bill's status is **TREFIN** | **TREFIN**; **4VD dhe TREFIN · Vetëm 4VD · Vetëm TREFIN** *(confirm)* | archive, legacy, imported |
| The outside bookkeeper | **accountant** | **kontabilist** *(confirm)* | bookkeeper, auditor |

## 6. Colour

Cool blue-grey paper and anthracite ink (the carwash canopy) carry everything; one amber marks brand, action and
place; status colours are quiet, always with words. Everything comes from
matched scales, so the colours sit at the same weight (reworked 2026-10-20: the
old cream, brown and burnt-orange tones were picked for clay and fought the amber).

### Scales
Six ramps in `admin/src/styles/tokens.css`: **neutral, amber, green,
red-orange, crimson, blue**, steps 50 to 990, built in OKLCH on one lightness
ladder, so a step is equally light in every colour. Amber 400 is the brand
`#f5b71a` itself. Screens never use a step (`var(--amber-400)`) directly, only
the named tokens below; `src/theme/scales.test.ts` fails if they do. To change
a colour, move its token to another step; to add a shade, take the next step.

| Role | Light | Dark |
|---|---|---|
| Fields, wells (sunk) | neutral 200 | neutral 990 |
| Page (canvas) | neutral 100 | neutral 975 |
| Cards, tables, sidebar (paper) | neutral 50 | neutral 950 |
| Oat (fill) / strong hairline | neutral 300 / 300 | neutral 900 / 800 |
| Ink / Muted Ink | neutral 950 / 700 | neutral 50 / 400 |
| Status words / tint | 700 / 100 | 400 / 900 |
| Amber text, focus | amber 700 | amber 400 |
| Amber key / hover / edge | amber 400 / 300 / 600 | same |

Neutrals are the cool blue-grey anthracite of the carwash canopy (hue 230, measured from photos 2026-10-20; kept faint, chroma 0.005–0.006, because the photos read bluer than the paint), so amber is the only warm thing
on screen; higher layers are lighter steps because shadows barely show on dark.

### Neutrals
- **Canvas** `#edf1f3` / night `#0d1012`: the page.
- **Paper** `#f5f9fb` / `#16191B`: cards, tables, sidebar, fields.
- **Sunk Paper** `#e1e5e7` / `#050809`: footer strips, row hover, callouts, search.
- **Oat** `#d4d8da` / `#2b2e30` (token `fill`): feature panels (Today, staff
  job tiles), ghost hover, segmented track.
- **Ink** `#16191B` / `#f5f9fb`: text, data, checked switches, count badges.
- **Muted Ink** `#585b5e` / `#bbbec0`: descriptions, labels, chart series.
- **Hairline** `#e1e5e7` / `#2b2e30` and **Strong Hairline** `#d4d8da` / `#424648`.

### Amber (brand)
4VD's own colour (chosen 2026-10-19), a warm yellow-orange a touch yellower than the firm's circle.
- **Amber** `#f5b71a` (both themes): the logo, the sunrise, **the one primary key
  per screen**, the menu tick, the selected row's edge and progress toward a goal.
- **Amber Mark** `#a37801` (amber 600, light only): small marks on paper that
  must reach 3:1 (rings, dots).
- **Amber Text** `#745504` / `#f5b71a` on **Amber Tint** (16%): the current
  menu item's label, selected rows, and any amber words. Bright amber is never
  text on paper.
- Text on amber is **Pillar Ink** `#0d1012` (white fails contrast: 1.9:1).

### Status (quiet)
Each has a strong colour for text and outlines, and a soft tint for washes.

| | Light (700) | Light soft (100) | Dark (400) | Dark soft (900) |
|---|---|---|---|---|
| **OK** (green) | `#386743` | `#e2f7e5` | `#99cda3` | `#253127` |
| **Warn** (red-orange) | `#894529` | `#feece5` | `#f8a788` | `#3c2821` |
| **Danger** (crimson) | `#8d3e47` | `#feebeb` | `#fda0a7` | `#3d2728` |
| **Info** (blue) | `#3e5e7e` | `#e6f2ff` | `#9dc2e9` | `#262f38` |

All four pass 4.5:1 on paper, canvas and oat in both themes and on their own
soft tint (`admin/src/theme/contrast.test.ts` must keep passing). Warn is
red-orange and danger crimson so neither reads as the brand.

### Crisp depth
Cards stay raised (never flat) but crisp: a 1px hairline edge and a white top
lip draw the outline, and the shadow is short and tight instead of a wide blur.
The canvas weave is faint (1.2% light, 1% dark).

### Focus
- **Focus ring = Amber Text** (`#745504` light, `#f5b71a` dark), 2px, offset 2px,
  standing off the control on paper (5:1 and more). There are no cool blue
  accents anywhere in the interface.

### Colour rules
- **The Amber Rule.** Amber means brand and "act here". **One amber key per
  screen** (a phone screen's bottom bar counts: if the Sell tab key is visible,
  the screen's own main action is a secondary key unless it *is* selling).
  Links, badges, charts and counts are never amber.
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
- **Labels** (table headers, figure labels, sidebar group names, kickers):
  plain body text, 13px/500 in Muted Ink, sentence case, no icon. Monospace
  capitals made the app read as AI-made (2026-10-20); only codes (SKUs,
  account numbers, receipt numbers) keep monospace. Never a sentence, never a button.
- **Page subtitles**: none by default. A page keeps one only when it says
  something you would otherwise ask (a period, a record's number and date, "These
  came from TREFIN"); generic "this page shows..." lines are gone.
- **Figures**: Hanken 600, 28px (36px on a large metric card), tabular. A figure
  tile with nothing to report ("None low") sits back in grey (`stat--quiet`);
  tiles have no icons.
- **Lists**: a product with no photo shows just its name (no empty box); long
  cell sentences become short values ("189 days ↓") with the sentence on hover
  and for screen readers.
- **The scale is closed**: 12 / 13 / 15 / 17 / 28 / 32 px (36px large figure)
  plus the display clamp and the one stock hero number on a product page
  (`--text-hero`, 72px). Dashboard tokens: `--text-xs` … `--text-lg`,
  `--text-figure`, `--text-figure-lg`, `--text-headline`, `--text-hero`.
  No 14px, no 20px one-offs. On the phone the Headline is 28px (the display clamp's floor), and text
  fields stay at 16px so iPhone Safari doesn't zoom in when one is tapped.
- Weights: 400, 500, 600 only (700 only in the wordmark and count badges).

## 8. Layout, surfaces and depth

### Layout
- 4px grid: 4, 8, 12, 16, 24, 32, 48.
- Dashboard: 56px top bar; 232px sidebar (60px collapsed; a drawer under 900px);
  content column max 1600px on every page (`--frame-wide`, 3.8; the Windows
  app's own download and welcome pages keep 1120px, `--frame-reading`); page padding 32/48 desktop, 32/24 under 1100px,
  24/16 under 900px. Sections stack 16px apart.
- Controls 36px (30px small) on desktop, **44px (36px small) under 900px**. Every tap area on a phone is at least 44px.

### Two kinds of surface
- **Raised card** (Paper + Raise shadow, 16px corners): things you work in:
  forms, the To do list, the Today strip, setting groups, metric cards.
- **Table surface**: a DataTable is itself a framed surface. **Never put a
  table inside a card** (no box in a box): a section is a heading plus a table.
- **Flat**: page header, toolbar, history headings sit on the canvas. A table's
  heading is a `Section` (heading on the canvas, then the table), never a `Card`.
- **Feature panel** (Oat + Sheen): the Today strip and staff Home job tiles only.

### Depth vocabulary (the only shadows allowed)
- **Raise**: cards and panels rest just above the canvas.
- **Inset**: fields, segmented tracks, card footer strips sit into it.
- **Key**: buttons stand on a solid edge (section 10.1).
- **Float**: palette, drawer, menus and dialogs over a dimmed backdrop.
- **Glass**: floating chrome only (section 8.1).
The user dislikes flat UI: surfaces keep this depth. Never invent a shadow,
never a glow.

### Light (the only gradients allowed on surfaces)
One soft light from above, never colour. Tokens in `tokens.css`, each with a
dark-mode twin:
- **Light raise** (`--light-raise`): layered over every raised surface's fill.
  The top catches the light and eases out over 96px in light mode (several
  stops, so there is no visible band). Dark mode gets only a 2.5% whisper
  fading over half the card, no shaded foot and no canvas light: on a dark
  screen anything more reads as glare.
- **Inset lip**: fields, tracks and footer strips are shaded for 10px under
  their top lip. This lives in the Inset shadow, not a gradient, so field
  text keeps a solid, measurable background.
- **Light canvas** (`--light-canvas`): the page is brightest under the top
  bar, fading out over the first screen.
No brand-colour gradients, none on tables, charts or glass, and no one-off
gradients in screens: use these tokens.

### 8.1 Glass (clean and purposeful)
Glass is for **chrome that floats over moving content**, so you can see the page
pass underneath. Allowed only on: the dashboard top bar, the Ctrl K palette, the
phone menu drawer, the staff tab bar, sticky phone action bars, and the
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
  `--glass-filter`.

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
hover (less jumpy in dense rows).

| Variant | Face | Edge | Use |
|---|---|---|---|
| **Primary** | Amber, lit from the top (linear: Amber Hover at the top to Amber at 60%) | 2px Amber Edge | the one main action per screen |
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
- **Loading** (`loading` on `Button`): a spinner in place of the
  icon (or before the label), the label stays, the key can't be pressed twice.
  Never swap the label for "Saving…".
- Sizes: 36px (30px small) desktop; 44px (36px small) phones. Padding 14px; icon
  16px with 6px gap; label 15px/500 (primary 600).
- **A row of actions shares one style**, apart from one primary. Never mix a
  raised key with bare text buttons in the same row.
- Width: buttons hug their label on desktop. Full width only at the bottom of a
  phone form or the Counter basket.

### 10.2 Links
Ink, underlined at 40% with a 3px offset, full underline on hover. Table title
links and breadcrumbs drop the underline until hover.

### 10.3 Fields
Paper, Strong Hairline stroke, Inset, 8px corners, 36px (44px phones), 15px text.
Label always visible above; placeholder only for an example. Focus: Ink ring as
buttons. Checked switches and checkboxes are Ink. **Dates always read
day / month / year** (`13/10/2026`) in both languages: the dashboard's
`DateField`, typed or picked from the calendar button at its end, never the
browser's native date input.

### 10.4 Tables (DataTable)
Every table is a `DataTable`: framed surface, optional toolbar and footer strips,
12px cells (16px at the edges), spec-label headers, hairline rows, sunk hover,
numbers right-aligned and tabular and never wrapped, ARIA table roles. On
desktop every table has ledger rows: 8px cells (3.8). A
**totals row** (`totals`, one cell per column) closes money columns: strong
hairline above, Oat, 600 weight; a trial balance puts its **Balanced** stamp
(ok) there, or **Off by …** (danger). The row whose record is open in an
Inspector is marked like the menu: Amber Tint with a 3px Amber bar on its first cell
(`table__row--selected`); columns that can wait while it is open take
`table__dock-hide`. Under 600px rows stack:
title cell first in 600 weight, then "column name: value" lines. An empty table
shows an empty state instead of headers.

### 10.5 Stamps (badges)
A small status word: 22px, Hanken 12px/600 in sentence case ("Finished", not
"FINISHED"), the status colour on its soft tint, 6px corners, no outline.
Tones: ok, warn, danger, info, neutral, ink. Monospace capitals made the app
read as AI-made (2026-10-20), so stamps no longer use them.
Severity stamps: **Urgent** (danger), **Check** (warn), **Idea** (info). On
phones a stamp sits **above** its text, not in a side column (`Badge`).

### 10.6 Numbers, money and dates
- **Money in tables and forms**: always cents (`€1,200.00`).
- **Headline figures** (metric cards, stat tiles, the Today sentence) of €1,000
  or more drop the cents (`€240,769`).
- **Zero is said in words**, not printed as a big 0: a tile with nothing shows a
  calm line at body size ("None low", "Not entered") via `StatTile` `words`, and
  filter counts of 0 are hidden.
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
  mark and label its real value. Every chart scales through the same
  `scaleTop` (daily bars, column charts, bar lists and mini graphs).
- `DayBars` is only the 30-day strip (Today, metric cards). A week or a day's
  hours is a `ColumnChart`, which keeps chart height whatever the width.
- Metric cards sit on an even grid: every card in a row has the same parts (all
  with a mini graph or none). No half-empty last rows: let the last card span.

### 10.8 Stock tag
The shelf count over the app's progress bar (the same inset track as sales
against a target): full at four times the reorder level, so the alert point is a
quarter along; the fill is the stock colour (fine, low, out). 6px in lists, 8px
under the big number on a product page. Fine stock is
quiet (number and bar only); low and out add their stamp.

### 10.9 Product photo
Square, 40px with 8px corners in lists, 112px with 16px in forms. With no photo,
show the placeholder: Sunk Paper with a Hairline ring and the
line box icon (not a letter).

### 10.10 Segmented controls
Joined options on an Oat inset track, the selected one raised on Paper. Used for
theme (Light / Dark / Auto, with icons) and language (English / Shqip) **in both
apps**, and for small view switches. Not for more than 4 options.
Inside a form it is a choice like radio buttons (`Segmented` in
`BillLines.tsx`): a supplier bill line's kind, Pay later / Paid now, how it was
paid. One tab stop; the arrow keys move the choice.

**The supplier bill form** (`/bills/new`) has no type menu: the lines' kinds,
the supplier (its usual kind, VAT, tax held back, abroad) and Pay later / Paid
now decide what the bill does. Cards: Who and when · What's on the bill ·
Customs (abroad with goods) · Paying; beside them, **What this bill does**: one
sentence from the server's preview, the figures, any **Costs went up** alerts,
and Save with the reason it waits ("Line 2 is not finished."). Returns and
credits start from the bill, in a side panel, with its lines filled in.

**Filter chips** (what a page or list shows: every list filter, every period
picker, Daily / Weekly on Reports, invoice kind, which carwash): one segmented
control (`.segmented`; `.segmented--chips` is the old name for the same): a
sunk Oat track, the chosen option raised on it in Paper and gliding to the next
choice. Loose round pills read as AI-made (2026-10-20). A filter dropdown beside
it (supplier, category, sort, compare) is a small raised key with the 8px
corner, the same height. Counts of 0 are hidden. On phones a long track scrolls
sideways in one line. A lone toggle is a `.chip`: a raised key, 8px corner. The period is always `PeriodPicker`, on its own row under
the page header (in the board head on Analytics); on a work page (3.8) it is
`PeriodPicker compact`, a dropdown inside the table's toolbar. Form and settings choices
(how paid, add/remove, theme, language, a view switch inside a card) keep the
track.

### 10.11a Inspector and menu button
`Inspector` shows one record opened from a list: at 1440px and wider it docks
beside the list (`InspectorLayout`, 400px, sticky under the top bar, raised
Paper, its heading takes focus, Esc or × closes and focus returns to the row's
key); narrower, it is a Sheet. Long names in its tables wrap.
`MenuButton` is a quiet key with a caret that opens a short list of related
actions (a page's downloads): Float shadow, 36px rows, arrow keys, Home/End,
Esc returns to the key, a click away closes it.

### 10.11 Navigation
Sidebar rows 34px (44px in the drawer): line icon + 500 label in Muted Ink;
hover Oat; current = Amber Tint fill, Amber Text label, 3px Amber marker on the edge.
Count badge: Ink pill with Paper text, To do count only (3.3).

## 11. The printed finish (vintage, used sparingly)

- **The shop at sunrise** (`admin/src/components/ui/ShopSunrise.tsx`): the mascot. Sign-in, the
  Overview hero, big empty pages, nowhere else. It is
  **never larger than the information beside it**: up to 360px in the Overview
  hero (standing on the page rule), 240px in empty states, 560px on sign-in. Hidden from screen readers;
  the sun rises once, off under reduced motion.
- **No paper grain**: the noise overlay was removed (2026-10-12); the canvas
  is clean ivory with only the faint pillar weave.
- **The canvas** (behind every page): the mark's **four pillars**
  woven very faintly across it (two staggered groups of four strokes per 72px
  tile; Ink at 3.5% light, 2.5% dark). No corner watermark (tried: one more
  thing to look at). Token `--weave-image`; off under more contrast and in print.
- **Rules**: a hairline under page titles.
- **Icon chips**: line icons in a 44px soft chip (Paper on Oat, Oat on Paper).
- **Block meters**: only the monthly target (20 blocks) and stock tags (10).
- **Receipt feel for the basket** (the Counter and Sell): lines in
  tabular figures, a dashed tear line above the total, the total in Figure type.
- Never dither or texture data, icons, tables or forms.

## 12. Motion and accessibility

- Motion: Apple's fluid motion, quiet; entrances inside
  `prefers-reduced-motion: no-preference`, and base.css stops every
  transition under reduce. One vocabulary in `admin/src/styles/motion.css`:
  - Anything that moves rides `--spring` over `--spring-time` (280ms): a
    critically damped spring (no overshoot, half-way at 50ms),
    the same in and out. Colour/hover is `--fast` 150ms on `--ease`.
  - Pages show at once: no entrance animation on pages or their sections,
    so moving around never waits on motion.
  - Selection glides: the chosen segment of every segmented track and the
    current sidebar item (with its orange tick) are one highlight that slides
    to the next choice (`selectionPills.ts`, no per-screen code).
  - Panels leave the way they came: the side sheet in from and out to the
    right, form still on it; the phone drawer with its backdrop.
  - Swipe on touch (`useSwipeToDismiss`): the side sheet and phone drawer
    follow the finger 1:1, rubber-band past the open edge, and on release
    project the flick to decide close or stay, starting at the finger's speed.
    Vertical drags still scroll; fields stay free for text selection.
  - Keys sink into their edge on press. Charts grow in once from their base.
    "Loading" waits 300ms, so a quick answer never flashes it. Light/dark
    cross-fades.
  - Only `transform` and `opacity` move (plus the highlight's size). No
    bounce, looping motion or parallax.
- WCAG AA contrast in both themes (contrast test). 44px touch targets on phones.
- Keyboard: every action reachable, visible focus, one tab stop per chart
  (arrows walk the data), dialogs trap focus and return it.
- Screen readers: ARIA labels match the visible words; a badge's label says what
  it counts ("3 to do").

## 13. Built vs target (known gaps, checked 2026-10-20)

Each item is a rule above that the code doesn't follow yet. Fix it when touching
that area; remove it from this list when done. The UI audit (`docs/archive/UI_AUDIT.md`)
closed the earlier gaps (words, date fields, dashboard receipt).

1. **Albanian numbers group from five digits**: "1578 €" sits above
   "238 969 €" in one column, so a right-aligned column changes rhythm. → 10.6
