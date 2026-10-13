# 4VD UI audit: consistency and layout

Date: 2026-10-13. Branch: `team-app-rest` (at `26d0ee3`).
Scope: dashboard (`admin/`) and team app (`mobile/`), checked against `DESIGN.md`.
No application code was changed for this audit.

## How this was checked

- Read `DESIGN.md`, `PRODUCT.md`, `progress.md`, `CLAUDE.md`, `admin/ui-policy.json`,
  `.impeccable/design.json`, both token files, both component kits.
- Grepped both apps for hard-coded colours, sizes, radii, shadows, native date
  inputs, banned words and kit bypasses.
- Opened 23 dashboard routes in Playwright at 1440px and 375px (Albanian, dark,
  demo data) and measured each one: page title, number of clay keys, ISO dates in
  the text, horizontal overflow, tap targets under 30px, tables inside cards, and
  every font size in use. Screenshots are in `.playwright-mcp/audit-*.jpeg`.
- Opened the team app on Expo web at 375px (English, dark): Home, Products, Sell,
  Account, and the Damage or loss picker.
- Light theme was spot-checked on the dashboard only (Sales).

**Not checked live:** team app in light mode and in Albanian, loading and error
states (read in code only, not triggered), very long names and prices, and a real
phone (Expo web only). These should be part of each batch's acceptance check.

---

## 1. Conventions to keep

These work, are applied consistently, and should not change.

| Convention | Where it lives | State |
|---|---|---|
| Source Serif 4 for page titles and the day's sentence; Hanken Grotesk for everything else | `tokens.css` `--font-display`, `theme.ts` `fonts.display` | Holds in both apps (two small leaks, see C-6) |
| Closed type scale 12 / 13 / 15 / 17 / 28 / 32 / 36 | `--text-*`, `theme.ts` `type.*` | Holds: no raw `font-size` in dashboard CSS, no raw `fontSize` in team-app screens. One off-scale title (D-6) |
| 4px spacing grid, named radii | `--space-*`, `--radius-*`, `spacing`, `radius` | Holds almost everywhere (see C-9 for small strays) |
| Ivory / paper / oat / ink, one clay | both token files | Light values match `DESIGN.md` exactly |
| One clay key per screen | `.button--primary`, `colors.cta` | Holds: no dashboard page shows more than one primary key |
| Tactile keys (2px edge, press down, flat when disabled) | `ui.css` `.button`, `theme.ts` `keyShadow()` | Same recipe in both apps |
| Raised card / inset field / float / glass depth vocabulary | `--shadow-raise`, `--shadow-inset`, `glass.css`, `colors.raise` | Applied; no invented shadows in screens (one exception in `ui.css:866`, a white swatch) |
| Mono capitals only for spec labels and stamps | `.badge`, metric labels, table headers | Holds on the dashboard; the team app's stamp is different (C-2) |
| Section tabs above a serif title, one-line description, actions on the right | `PageHeader` | Used by every dashboard page except Overview (by design), the product page and the account pages |
| Every table is a `DataTable`, stacking on phones | `components/ui/DataTable.tsx` | Holds; no hand-built `<table>` except `CustomersPage` statement print and `BasketForm` |
| No horizontal scroll at 375px | layout | Holds on all 23 dashboard routes measured |
| Glass only on floating chrome | top bar, palette, drawer, tab bar | Holds |
| Team app tab bar Home · Products · Sell · Account with Sell as the clay key | `RootNavigator.tsx` | Holds |

---

## 2. Verified inconsistencies

Each item has the file, what differs, and what it should match. "C" = across both
apps, "D" = dashboard, "M" = team app.

### Across both apps

**C-1. Dark-theme colours in code don't match `DESIGN.md`.**
Both token files agree with each other, but not with the rulebook's frontmatter
and section 6. Examples (rulebook → code): canvas `#191817` → `#151413`, paper
`#262624` → `#252421`, sunk `#151413` → `#0f0e0d`, oat `#30302e` → `#2e2d29`,
ink `#faf9f5` → `#f3f1ea`, muted `#a6a39b` → `#b0ada4`, hairline `#2f2e2b` →
`#3a3834`, ok `#86c08f` → `#7ccf8e`, warn `#e0a85a` → `#f0b45a`, danger
`#f39a8f` → `#ff8f80`, info `#9fb4cc` → `#8fb8e8`, and all four dark soft tints.
Files: `admin/src/styles/tokens.css` (`[data-theme='dark']`),
`mobile/src/theme.ts` (`dark`), `DESIGN.md` lines 28–46 and the table in 6.
The code values are the ones the contrast test checks. Dark info `#8fb8e8` is
also noticeably bluer than the rulebook's slate, which is close to the "no cool
blue accents" line. **Needs your decision** (see the end).

**C-2. Status stamps look different in each app.**
Dashboard `.badge` (`admin/src/components/ui/ui.css:717`): 22px, monospace
capitals, 3px corners, outline only. Team app `HomeScreen.tsx:496` `stamp`:
Hanken bold, 8px corners (`radius.small`), no fixed height. The team app has no
shared stamp component, so the To do stamps on Home, the stock words in
`StockTag.tsx` and the request stamps in `RequestsScreen.tsx` each style status
their own way. On screen the Home "CHECK" reads as a rounded pill, the dashboard's
as a squared rubber stamp.

**C-3. Buttons don't keep their label while busy, in either app.**
`DESIGN.md` 9 and 10.1: spinner replaces the icon, label stays, width holds.
- Dashboard `Button` (`admin/src/components/ui/Button.tsx`) has no loading prop.
  49 call sites swap the label for other text instead
  (`isPending ? t.common.loading : …`), so the key changes width mid-press.
- Team app `Button` (`mobile/src/components/ui.tsx:45`) replaces the whole label
  with a spinner.

**C-4. Button and field heights differ from the rulebook on phones.**
`DESIGN.md` 8 and 10.1: 44px (36px small) on phones. Team app `Button` and
`TextField` are 48px (`ui.tsx` `button.minHeight`, `input.minHeight`). The team
app has no small key, so screens hand-build their own:
`AccountScreen.tsx:332` `smallKey` (36px), `MySales.tsx:218` `returnKey` (36px),
`RecordSaleScreen.tsx:533` `extraChip` (36px), `RecordSaleScreen.tsx:518`
`clear` (32px), `AccountScreen.tsx:326` `linkRow` (32px), `inputs.tsx:186`
segmented option (40px). Some have the key edge, some don't.

**C-5. Segmented control track colour.**
Dashboard `.segmented` (`admin/src/styles/shell.css:416`) sits on Oat
(`--fill`) as `DESIGN.md` 10.10 says. Team app `Segmented`
(`mobile/src/components/inputs.tsx:158`) sits on Sunk Paper. In dark mode the
team-app track is near-black (`#0f0e0d`), so Account's Theme and Language
switches look like holes rather than the dashboard's oat tray.

**C-6. Serif used for card-level names.**
`DESIGN.md` 7: serif never for card titles. Team app `AccountScreen.tsx:323`
puts the person's name in the serif at 28px inside the profile card. (The
dashboard profile header card uses Hanken.) `ProductDetailScreen.tsx:145` uses
the serif for the product name, which is fine as it acts as the screen title.

**C-7. Two header sizes in the team app.**
`RootNavigator.tsx:124` tab screens use the serif at 28px; `RootNavigator.tsx:202`
stack screens (Requests, End shift, My sales, Tabs, modals) use the serif at 17px.
At 17px the serif looks like a card title, which the rulebook reserves for Hanken.

**C-8. "Fine" stock is stamped as loudly as a problem.**
Both apps put a green "IN STOCK" / "NË STOK" stamp on every healthy row
(dashboard Stock list, team app Products list) next to a bar that already shows
the level. `DESIGN.md` principle 6 ("calm at rest") and 3.3 ("everything else is
quiet") point the other way: only low and out need words. On the Stock page every
row carries number + bar + stamp for the same fact.

**C-9. Minor off-grid values** (low priority, fix when touching the file).
Dashboard: `gap: 6px`, `padding: 10px`, `padding: 0 6px 0 10px`, `padding: 20px
12px` in `shell.css` and `team.css`. Team app: raw radii `12`, `14`, `18`, `10`
in `RecordSaleScreen.tsx:508`, `ScanBillScreen.tsx:119`, `CatalogScreen.tsx:218`,
`EndShiftScreen.tsx:124`; `radius.board: 20` in `theme.ts` is not in the rulebook.
Team app `type.hero` is 64, the rulebook's hero is 72.

**C-10. Design tooling is out of date.**
`.impeccable/design.json` still describes the old palette ("Signal Orange
`#ff5e1f`", white paper, `#faf9f7` canvas). Anything reading it will suggest the
wrong colours.

### Dashboard

**D-1. Tables inside cards (box in a box).** `DESIGN.md` 8 forbids it. Measured:
- `/sales`: "Historiku" card (`card card--flush`) wraps the sales `DataTable`
  (`pages/SalesPage.tsx`). The card heading also repeats the tab name "Historiku".
- `/day`: "Të ardhurat e lavazhit" card wraps the carwash table (`pages/DayPage.tsx`).
- `/expenses`: both "Shpenzimet në këtë periudhë" and "Përsëriten çdo muaj"
  (`pages/ExpensesPage.tsx`).
- `/report`: "Më të shiturat" and "Ekipi" (`pages/ReportPage.tsx`).
- `/cash` and `/carwash` also report a table inside a `.card`.

**D-2. Dates printed as `2026-10-14`.** `DESIGN.md` 10.6: never month-first or
ISO. Seen in the To do detail on Overview and Inbox ("Afati: 2026-10-14") and in
the team app's To do (same text), and in Activity ("2026-10-07"). The text comes
from the shared attention source, so one fix covers both apps.

**D-3. Native date inputs show `10/13/2026`, even in Albanian.** Open gap 2.
17 native `type="date"` inputs in 12 files: `components/BillParts.tsx` (2),
`ExpiryCard.tsx`, `PeriodPicker.tsx` (2), `pages/BillDetailPage.tsx`,
`CarwashPage.tsx`, `DayPage.tsx`, `DocumentsPage.tsx` (2), `ExpensesPage.tsx`,
`OrderDetailPage.tsx`, `PromotionsPage.tsx` (2), `ReportPage.tsx`,
`SalesPage.tsx` (2). The Day page puts it right in the header, so the owner's
daily page reads month-first.

**D-4. Metric rows aren't even.** `DESIGN.md` 10.7: every card in a row has the
same parts.
- `/sales`: only Revenue has a mini graph; Profit, Sales and Average sale are the
  same height with empty space where the graph would be.
- `/reports` (Analytics): rows 3–4 mix cards with and without a sub-line and
  with and without the "…" menu (Lavazhi, Dyqani + Lavazhi and Marzhi have none).
- Overview figure tiles: three tiles have a sub-line, "Kontrollet e mbylljes 1 / 7"
  has none.

**D-5. Big figures still show cents, and zeros are shown as figures.**
- `/sales` "Shitja mesatare 9311,46 €": a headline figure over €1,000 keeps its
  cents (`DESIGN.md` 10.6).
- `/inventory` tiles "Stok i ulët 0", "Pa stok 0", "Mbaron këtë javë 0" and the
  Overview tile "Për të furnizuar 0" print zero at 28px. `DESIGN.md` 3.3 and
  principle 6: zero is calm words, emphasis never goes to zeros. The filter
  segments on Stock also show "0" count bubbles.
- Overview "Lavazhi sot: Pa u futur" puts a status sentence in figure size and
  warn colour, the loudest thing in the row.

**D-6. Overview greeting is 44px.** `pages.css:193`
`clamp(1.75rem, 3.6vw, 2.75rem)` goes past the closed scale (top is 36px) and past
`ui-policy.json`'s `h1` rule (28 / 32 / 36), so `npm run lint:ui` should flag it.

**D-7. Outlier capping only on one chart.** `/reports` "Shitjet në ditë" caps
the huge day correctly. The four charts below don't: "Ditët më të mira të javës",
"Orët më të ngarkuara", "Të ardhurat sipas kategorisë", "Produktet kryesore" and
"Renditja e ekipit" each show one full bar and the rest as slivers.
The Revenue and Profit sparklines on `/sales` and `/reports` are flattened the
same way. (`components/SalesPatterns.tsx`, `components/ui/BarList.tsx`,
`components/ui/sparkline.ts`.)

**D-8. Number grouping changes within one column (Albanian).** "238 969 €" next
to "1578 €", "1900 €", "1569". Albanian number formatting doesn't group 4-digit
numbers, so the same column mixes grouped and ungrouped figures. Cosmetic, but it
breaks the right-aligned scan.

**D-9. Two different period pickers.** `/sales` uses a segmented control
(Sot · Dje · Kjo javë · Ky muaj · Data të zgjedhura). `/reports` uses a select
("Ky muaj") plus a compare select and a refresh icon key for the same idea.

**D-10. Words.** Open gap 1 confirmed: `admin/src/i18n/en.ts` still says "Cash
check" (lines 1394, 1437, 1945, plus hints at 1302, 1715, 2021, 2032) and "mobile
app" (1012, 1614); `sq.ts:1284` "kontrolli i arkës". Also: the tab is "Analiza"
but the section heading under it says "Analitika"; the Sales section heading
"Historiku" repeats its own tab.

**D-11. "Record a sale" vs "Sell".** The glossary says **Sell** is the tab, title
and opening button, and "Record a sale" is never a title. The dashboard's opening
button on Overview and Sales says "Record a sale" / "Regjistro një shitje"; the
team app says "Sell". The rulebook wording allows either reading for a *button*,
so this needs your call (see the end).

### Team app

**M-1. Products list is a stack of raised cards.** Each row in
`CatalogScreen.tsx` / `ProductCard.tsx` is its own card with a border and the
Raise shadow, six visible at once. With the 10-block meter and the "IN STOCK"
stamp (C-8), every row has four visual layers. A list on one surface with
hairline rows would carry the same information more calmly.

**M-2. Sell tiles are mostly placeholder.** `RecordSaleScreen.tsx` tiles are
three to a row with a square photo well. With few product photos (the real shop
today), five of six tiles are a large near-black box with a small icon, and the
names wrap to two lines in what's left. The photo well, not the name and price,
is the biggest thing on the screen.

**M-3. Favourites chip doesn't look like favourites.** `DESIGN.md` 3.2: a
Favourites filter chip with the star. In `CatalogScreen.tsx` it is a plain text
chip in the same row as the categories, with no star.

**M-4. Picker mode keeps the "Products" title.** Damage or loss (and the other
"pick a product" flows) open Products with a "Which product was damaged or
lost?" strip and Cancel, but the screen is still titled "Products" and the rows
still look like browsing. The question is in 15px bold under a 28px serif title
that says something else.

**M-5. Small targets.** Account "Change photo" link 32px, "Only show what's in
stock" switch 40×20 visible area, header avatar 40×40, plus the hand-built keys
in C-4. `DESIGN.md` 12: 44px on phones.

**M-6. Error state has no title or icon.** `ui.tsx` `ErrorState` shows only the
error text and Try again; `EmptyState` has an icon chip and a serif title. The
dashboard `EmptyState` and `Feedback` give both a title. An error on the phone
therefore looks weaker than an empty list.

---

## 3. Layout problems, by priority

Ranked by how much they slow someone down, then by how many screens they touch.

| # | Problem | Screen | Cause |
|---|---|---|---|
| 1 | Day page date reads month-first in both languages | Dashboard Day (and 11 other forms) | Native `<input type="date">` (D-3) |
| 2 | To do items show `2026-10-14` | Overview, Inbox, team-app Home | Raw date in the attention text (D-2) |
| 3 | Sales and Expenses lists sit in a card inside the page, with a heading that repeats the tab | Sales, Expenses, Day, Report | Table wrapped in `.card` (D-1). An extra frame, an extra heading row and 24px of padding before the first row |
| 4 | Stock on a phone: 6 products take ~1,000px | Dashboard Stock at 375px | Stacked rows print every column as a line, including empty ones ("Porosit –"); the stamp and bar repeat the number; the filter segments wrap to two lines above two selects (weak grouping, empty lines) |
| 5 | Overview on a phone: To do starts below the first screen | Dashboard Overview at 375px | The sunrise is placed above the title on narrow screens, pushing the greeting and To do down ~200px (order, not size) |
| 6 | Metric rows half empty | Sales, Reports Analytics, Overview tiles | Uneven card parts (D-4): one card has a graph, the rest keep its height with nothing in it |
| 7 | Stock tiles shout zeros | Stock, Overview | Zero shown at figure size (D-5); the most important number on a healthy day is a large "0" |
| 8 | Charts with one bar | Reports Analytics, Sales sparklines | No outlier cap outside the daily chart (D-7) |
| 9 | Products list feels heavy | Team app Products | Card per row plus four status layers (M-1, C-8). Too many containers |
| 10 | Sell grid is mostly empty boxes | Team app Sell | Photo well dominates the tile when there is no photo (M-2). Oversized component for the data on hand |
| 11 | Sales rows have a separate "Hap" link column | Dashboard Sales | The whole row already opens the sale; the extra 23px link column adds a narrow target and a column of repeated words |
| 12 | Account looks like a different app's settings | Team app Account | Serif name in the card (C-6), near-black segmented tracks (C-5), 32–36px hand-built keys (C-4) |
| 13 | Day page repeats itself | Dashboard Day | The page description and the checklist sub-line say the same sentence ("Asgjë nuk kyçet…"); two different empty treatments on one page (icon chip without a title for cash counts, bare sentence for expenses) |

What is **not** a problem and shouldn't be "fixed":
- The Day checklist's column of secondary keys: one per open step, all the same
  style, as the rulebook asks. Adding a primary would break the Clay Rule.
- The Sales table's day group rows: they are the moment grouping the rulebook
  asks for (3.5) and they scan well.
- Empty space beside the Overview title at 1440px: it is where the sunrise stands
  and it gives the page its calm. Filling it with cards would be wrong.

---

## 4. Findings by product

Already grouped in section 2: **dashboard** D-1 to D-11, **team app** M-1 to
M-6, **cross-product** C-1 to C-10. Section 3 ranks them.

---

## 5. Documented gaps still open (`DESIGN.md` 13)

| Gap | State in code today |
|---|---|
| 1. "Cash check" and "mobile app" in dashboard text | **Still open.** 7 "cash check" strings and 2 "mobile app" strings in `admin/src/i18n/en.ts`, 1 in `sq.ts` (D-10) |
| 2. Native date inputs show mm/dd/yyyy | **Still open.** 17 inputs in 12 files; seen as `10/13/2026` on the Albanian Day page (D-3) |
| 3. Dashboard Sell basket has no receipt feel | **Still open.** `admin/src/components/BasketForm.tsx` has no dashed tear line, no tabular receipt lines and no total in Figure type |

Rules the code doesn't follow that are **not** in the gap list yet (add them if
you agree): C-1, C-2, C-3, C-4, C-5, C-8, D-1, D-2, D-4, D-5, D-6, D-7.

---

## 6. Implementation batches

Small, one area each, ordered by impact against risk. None touches business
logic, permissions or API shapes, except B1's date text, which changes only how
a date inside a string is formatted.

**B1. Dates and words** (text only, both apps)
- Format the due date inside To do texts as `14 Oct` / `14 tet` (D-2), and the
  Activity date.
- Replace "Cash check" → "cash count" / "Count the drawer", "mobile app" → "team
  app" in the dashboard catalogues, and the Albanian equivalents (gap 1).
- "Analitika" heading matches its tab; drop the "Historiku" heading that repeats
  the Sales tab (it goes away with B2 anyway).
- Remove gap 1 from `DESIGN.md` 13.

**B2. Tables out of cards** (dashboard CSS + JSX on 5 pages)
- Sales history, Day carwash, both Expenses tables, Report top sellers and team,
  Cash counts, Carwash: section heading on the canvas + `DataTable` (D-1).
- Day page: one empty-state treatment (row 13 in section 3) and no repeated sentence.

**B3. Even metric rows and calm zeros** (dashboard)
- Sales metric cards all with a mini graph, or all without (D-4).
- Reports Analytics: every card in a row gets the same parts; the last row
  spans so there are no half-empty rows.
- Headline figures ≥ €1,000 drop cents everywhere (D-5).
- Zero tiles show calm words ("None low", "Nothing out") in body text, not "0"
  at figure size; zero count bubbles hidden in filter segments.
- Overview "Lavazhi sot" not-yet-entered shown as words at body size.
- Overview greeting back on the scale (D-6).

**B4. Outlier cap on every chart** (dashboard)
- Apply the existing cap from the daily chart to weekday, hour, bar lists and
  sparklines (D-7). Reuse the logic already in the daily chart; don't write a
  second one.

**B5. Quieter stock status** (both apps)
- Fine stock shows the number and bar only; stamps only for low and out (C-8).
- Team-app Products: rows on one surface with hairlines instead of a card per
  row (M-1).

**B6. Phone layout of the dashboard**
- Stacked rows hide cells that are empty ("–").
- Stock toolbar: search on its own line, then one row of filters; selects don't
  wrap under the segments.
- Overview at < 900px: title and To do first, sunrise smaller beside or after the
  greeting, not above it.
- Sales: the whole row opens the sale; remove the separate "Hap" column, keep the
  invoice link (row 11).

**B7. One button recipe for busy and small** (both kits)
- Dashboard `Button` gets `loading`: spinner in place of the icon, label stays,
  width holds; replace the 49 label swaps (C-3).
- Team app `Button`: label stays with a spinner; add `size="small"` (36px) and
  the danger look; replace `smallKey`, `returnKey`, `extraChip`, `clear`,
  `linkRow` with it (C-4).
- Heights per your decision on 44 vs 48 (see the end).

**B8. Team-app kit alignment**
- One `Stamp` in the team app matching the dashboard badge (mono, 3px, 22px), used
  by Home To do, Requests and the stock tag (C-2).
- `Segmented` on the Oat track (C-5).
- Account name in Hanken title size (C-6). Stack headers at one size (C-7).
- Favourites chip with the star (M-3). Picker mode titled by its question (M-4).
- `ErrorState` with an icon chip and title like `EmptyState` (M-6).
- Small targets to 44px (M-5).

**B9. Sell tiles** (team app)
- Tiles without a photo get a compact layout: small placeholder, name and price
  given the room (M-2). Tiles with photos unchanged.

**B10. Day / month / year date field** (dashboard, gap 2)
- One shared date field in `components/ui` reading `13/10/2026` in both
  languages, with the calendar still available; replace the 17 native inputs.
  Larger than the others because it touches every form with a date, so it goes
  after the quick wins.

**B11. Dashboard basket receipt** (gap 3)
- `BasketForm.tsx`: tabular lines, dashed tear line, total in Figure type,
  matching the team app's Sell.

**B12. Rulebook and tooling in step**
- `DESIGN.md` dark colours and button heights updated to match your decision
  (C-1, C-4); `.impeccable/design.json` regenerated from `DESIGN.md` (C-10);
  section 13 updated with what's closed and the newly found gaps.

---

## 7. Acceptance criteria per batch

Every batch also passes: both themes, EN and SQ, 375px and 1440px screenshots,
`npm run lint:ui` clean (or a scoped exception with a reason), no new hard-coded
values, and the existing tests.

| Batch | Done when |
|---|---|
| B1 | No `\d{4}-\d{2}-\d{2}` in the rendered text of Overview, Inbox, Activity or team-app Home. `grep -i "cash check\|mobile app"` on `admin/src/i18n` finds nothing. No section heading repeats its tab's name. |
| B2 | Measuring `.card [role=table]` on every dashboard route returns 0. Each of those sections reads as heading on the canvas, then the framed table, with 16px between them. The Day page uses one empty-state style. |
| B3 | On Sales and Reports, cards in the same row have identical parts (graph / sub-line / menu all present or all absent). No headline figure ≥ €1,000 shows cents. No figure-size "0" on Stock or Overview. Overview `h1` measures ≤ 36px at 1440px. |
| B4 | With the demo data (one €240k day), every bar in the weekday, hour, category, product and team charts is visibly taller than 2px when it has a value, and the capped bar shows its real value. |
| B5 | Healthy stock rows show no stamp in either app; low and out rows still do, with words. Team-app Products rows share one surface. A colour-blind check still reads low vs out from the words. |
| B6 | At 375px, Stock shows at least 4 products in the first two screens and no line reads "–". Overview's To do heading sits within the first 812px. Sales rows open on tap with no separate "Hap" column. |
| B7 | Pressing Save on a slow network: the label stays and the key's width doesn't change (measure before/after). No hand-built key styles left in `AccountScreen`, `MySales`, `RecordSaleScreen`. All keys measure 44px (36px small) on phones. |
| B8 | Home, Requests and Products stamps match the dashboard badge side by side (font, corner, height). Segmented tracks are Oat in both apps in both themes. Every team-app interactive element measures ≥ 44px. An error screen shows icon, title, sentence and Try again. |
| B9 | With no photos, a Sell tile's name and price take more room than its placeholder; names fit on two lines at 375px. Tiles with photos look as they do today. |
| B10 | `grep 'type="date"'` in `admin/src` finds nothing. Every date field reads `13/10/2026` in English and Albanian, keyboard-typable and usable with a screen reader. Gap 2 removed from `DESIGN.md` 13. |
| B11 | The dashboard basket and the team-app basket, screenshotted side by side, share tear line, tabular lines and Figure-size total. Gap 3 removed. |
| B12 | `DESIGN.md` frontmatter colour values equal `tokens.css` and `theme.ts` in both themes. `.impeccable/design.json` has no `#ff5e1f`. |

---

## Decisions needed from you

1. **Dark colours (C-1).** The code's dark palette was tuned after the rulebook
   was written (the "easier on the eyes" change). Recommendation: keep the code,
   update `DESIGN.md` to match. The alternative is moving both apps back to the
   rulebook's values, which changes how dark mode looks.
2. **Team-app key height (C-4).** Rulebook says 44px, the app uses 48px.
   Recommendation: keep 48px for full-width keys and fields at the counter
   (bigger thumbs target, already shipped) and write that into the rulebook;
   use 44px / 36px for row and small keys.
3. **"Record a sale" vs "Sell" (D-11)** on the dashboard's opening button.
   Recommendation: "Sell" / "Shit", matching the glossary and the team app.
