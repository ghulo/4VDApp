---
name: 4VD
description: The Dacaj family shop's stock, sales and team in one calm, precise interface; ink on ivory paper with oat panels, a clay brand colour and dithered drawings.
colors:
  clay: "#d4704f"
  clay-text: "#a8482a"
  clay-tint: "rgb(217 119 87 / 0.14)"
  clay-tint-dark: "rgb(217 119 87 / 0.18)"
  ember-text: "#c2410c"
  ember-text-dark: "#ff7038"
  pillar-ink: "#1c0f08"
  ivory-canvas: "#f0eee6"
  paper: "#faf9f5"
  sunk-paper: "#e8e4da"
  oat: "#e3dacc"
  ink: "#141413"
  ink-muted: "#5e5d59"
  hairline: "#e0dbcf"
  hairline-strong: "#cbc3b3"
  night-canvas: "#1f1e1d"
  night-paper: "#262624"
  night-sunk: "#1a1918"
  night-oat: "#30302e"
  night-ink: "#faf9f5"
  night-muted: "#a6a39b"
  night-hairline: "#2f2e2b"
  night-hairline-strong: "#3e3d39"
  ok: "#047857"
  ok-soft: "#e6f5ee"
  warn: "#b45309"
  warn-soft: "#fef3e2"
  danger: "#b91c1c"
  danger-soft: "#fdecec"
  info: "#1d4ed8"
  info-soft: "#e8efff"
typography:
  display:
    fontFamily: "Source Serif 4, Georgia, Times New Roman, serif"
    fontSize: "clamp(1.75rem, 3.2vw, 2.25rem)"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.01em"
    fontFeature: "lnum"
  headline:
    fontFamily: "Source Serif 4, Georgia, Times New Roman, serif"
    fontSize: "2rem"
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
    letterSpacing: "-0.01em"
  body-large:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.5
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
rounded:
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
    backgroundColor: "{colors.signal-orange}"
    textColor: "{colors.pillar-ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.signal-orange-hover}"
  button-primary-disabled:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink-muted}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.sunk-paper}"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.fill}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
    height: "36px"
  card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.card}"
    padding: "16px 24px 24px"
  card-foot:
    backgroundColor: "{colors.sunk-paper}"
    textColor: "{colors.ink-muted}"
    padding: "12px 24px"
  nav-item:
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "34px"
  nav-item-hover:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
  nav-item-current:
    backgroundColor: "{colors.orange-tint}"
    textColor: "{colors.ember-text}"
  count-badge:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    typography: "{typography.caption}"
    height: "20px"
  badge:
    rounded: "{rounded.pill}"
    typography: "{typography.caption}"
    padding: "0 8px"
    height: "22px"
  today-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.display}"
    rounded: "{rounded.card}"
    padding: "24px 32px"
  metric-card:
    backgroundColor: "{colors.paper}"
    typography: "{typography.figure}"
    rounded: "{rounded.card}"
    padding: "16px 16px 0"
  callout:
    backgroundColor: "{colors.sunk-paper}"
    rounded: "{rounded.control}"
  chart-tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
---

# Design System: 4VD

## Overview

**Creative North Star: "Calm Shop"**

Four equal pillars hold up one roof: the four Dacaj brothers holding up the family
shop. The interface carries that idea as structure and fairness rather than
ornament: hairline frames, equal columns, nothing bigger or louder than its job.
The structure is Cloudflare's dashboard (a grouped sidebar, warm neutrals, hairline
tables, Ctrl K to jump anywhere, dense analytics cards); the rigour is the SBB design
system's (reduced content, plain words, responsive spacing, 44px touch targets);
the finish is anthropic.com's calm (a serif voice for headings, ink-coloured
underlined links, generous quiet around the few things that matter).

It is a working tool for a shop counter, read in the morning and used all day.
Working screens are plain paper on a warm canvas. The Overview is a calm morning
page that says the day in one serif sentence; the dense figures live on Reports.
Data is drawn in ink, and so are actions; clay marks the brand and where you are.
Dots are the brand's signature (Cloudflare's and Anthropic's language too):
a halftone field frames the page column, data is drawn in dots, and the four-pillar
mark is made of them. They stay out of tables and forms, where they'd be noise.

**Key Characteristics:**
- Ink on ivory paper with oat panels; flat surfaces, no shadows at rest.
- One clay brand colour (`#d4704f`) for the logo, the drawings and where you are; actions in solid ink.
- A serif (Source Serif 4, 500) for page titles, the day's headline and sign-in headings; a grotesk (Hanken Grotesk) for everything else, every figure tabular.
- Charts and counts in ink and muted ink, never clay.
- 15px body for comfortable reading; 44px controls on phones.
- Quick, soft motion (150ms, gentle ease-out); off when the computer asks for less.
- Both themes first-class; dark is warm (`#151414`), not blue-black.

## Colors

Warm, slightly beige neutrals carry almost everything; one orange marks action and
place; status colours stay quiet and come with faint tints.

### Primary
- **Clay** (#d4704f): the brand colour, after Anthropic's book-cloth orange: the logo
  tile, the dithered drawings, the 3px marker on the current menu item. Softer than
  the old Signal Orange (#ff5e1f), which looked loud on ivory.
- **Clay Tint** (14% light, 18% dark): the fill behind the current menu item.
- **Clay Text** (#a8482a light / #e08a6b dark): the label of the current menu item.
- **The main button is solid Ink** with Paper text (in dark mode: Night Ink with
  Ink text), as on anthropic.com. Hover #3d3d3a.

### Neutral
- **Ivory Canvas** (#f0eee6) / **Night Canvas** (#1f1e1d): the page.
- **Paper** (#faf9f5) / **Night Paper** (#262624): cards, tables, sidebar, top bar.
  Dashboard cards have no frame; paper on ivory is enough.
- **Sunk Paper** (#e8e4da) / **Night Sunk** (#1a1918): card footer strips, row hover,
  callouts, the search field, the sign-in story panel.
- **Oat** (#e3dacc) / **Night Oat** (#30302e), token `fill`: the feature panels (the
  Today panel in both apps, the team app's job tiles), ghost and menu hover, the
  segmented control track, the disabled main button.
- **Ink** (#141413) / **Night Ink** (#faf9f5): text, links, the main button, the
  active chart bar, count badges, checked switches and checkboxes, the tooltip.
- **Muted Ink** (#5e5d59) / **Night Muted** (#a6a39b): descriptions, labels, table
  headers, and every chart series.
- **Hairline** (#e0dbcf) and **Strong Hairline** (#cbc3b3) (night #2f2e2b / #3e3d39):
  every border, grid line and unlit halftone dot; strong for control strokes.

### Status
- **OK** (#047857), **Warn** (#b45309), **Danger** (#b91c1c), **Info** (#1d4ed8),
  each with a faint tint for badges, notices and banners; brighter variants in dark
  mode (#34d399, #fbbf24, #f87171, #60a5fa). Info doubles as the focus ring colour.
  Metric changes use OK for up, Danger for down, Muted Ink for flat.

### Named Rules
**The Clay Rule.** Clay is the brand, not a button: the logo, the dithered drawings
and where you are (current menu item). Actions are solid ink. Badges, links, charts
and counts are never clay.

**The Ink Data Rule.** Data is drawn in ink: chart series in Muted Ink, the active
bar or point in Ink, count badges in Ink with Paper text. Orange in a chart would
read as a button.

**The Dots Rule.** Dots are 4VD's identity, used at low volume rather than removed:
the 8px halftone field in the margins either side of the page column (desktop; the
column itself is plain canvas, max 1120px), data drawn in dots (the sales chart as
dot columns, metric graphs as a halftone area under a line, the Today card's
30-day dot-matrix strip with faint unlit dots), the halftone corner on the team
app's Today card, and the four-pillar drawing. Never in tables, forms or behind text.

**The Contrast Rule.** Every text and colour pair is checked by
`admin/src/theme/contrast.test.ts` (WCAG AA): clay reaches 3:1 on paper as a UI
colour, clay text reaches 4.5:1 on paper and on its tint.

## Typography

**Display Font:** Source Serif 4, weight 500 (with Georgia, Times New Roman)
**Body Font:** Hanken Grotesk (with system-ui)

**Character:** A quiet editorial serif sets the tone at the top of a page; an
engineered grotesk does all the work underneath. The serif never carries a number in
a column, a control or a label.

### Hierarchy
- **Display** (serif 500, clamp(1.75rem, 3.2vw, 2.25rem), 1.15, lining figures): the
  day's headline on the Overview, one sentence, max 28ch. Sign-in headlines use the
  same voice at up to 2.75rem, and the sign-in card title at 1.75rem.
- **Headline** (serif 500, 2rem, 1.15, balanced wrap): page titles, one per page.
- **Figure** (grotesk 600, 1.75rem, tabular, -0.02em): metric and stat values;
  2.25rem on a large metric card.
- **Title** (grotesk 600, 1.0625rem): card, board and empty-state titles.
- **Body large** (400, 1.0625rem, muted): the description under a page title (max
  68ch) and the day's comparison line.
- **Body** (400, 0.9375rem, 1.5): everything else, tables included.
- **Label** (0.8125rem): field labels (600), table headers and metric labels (500,
  muted), breadcrumbs.
- **Caption** (600, 0.75rem): badges, sidebar group names, palette group names.

### Named Rules
**The Serif Ration Rule.** The serif is for page titles, the Overview day headline
and sign-in headings only. Card titles, figures, tables and controls stay in Hanken
Grotesk.

**The Tabular Rule.** Every number that can sit in a column or change in place uses
tabular figures.

**The No Shouting Rule.** No weight above 600 outside the wordmark and count badges;
sentence case everywhere except spec labels.

**The Spec Label Rule.** Short labels over figures and columns (table headers, stat
and metric labels, sidebar group names, the team app's date kicker) are set in
monospace capitals, 12px, 0.06em tracking, like anthropic.com's DATE / CATEGORY rows.
Never a sentence, never a button.

## Layout

A 56px top bar (see-through with blur) spans the page: logo and shop name, a search
field labelled "Search or jump to" with a Ctrl K hint, theme switch and account on
the right. Under it a 232px sidebar sits on the left in named groups (Today,
Shelves, Business) and collapses to 60px icons; under 900px it becomes a drawer
opened from the top bar. The page lives in a plain column of at most 1120px on the
warm canvas, framed on desktop by the halftone dot field in the margins (a fixed,
screen-sized layer, so only one screen of dots is painted).

Spacing runs on a 4px grid (4, 8, 12, 16, 24, 32, 48). Page padding steps down with
the screen, after SBB's responsive spacing: 32/48px on desktop, 32/24px under
1100px, 24/16px under 900px. Every page opens with the same header (breadcrumb,
serif title, one-line description, actions on the right), then cards stacked 16px
apart. Two related cards may sit side by side and stack on narrow screens.

Density is earned per page. The Overview is sparse: setup checklist, the day card,
what needs attention, what needs restocking, and a link to Reports. Reports is the
dense page: a four-column grid of metric cards (two columns under 960px, one under
560px) with large cards spanning two.

**The Same Header Rule.** Every page starts with the shared page header. No page
invents its own title block.

**The Stacking Table Rule.** Under 600px a table marked to stack shows each row as a
block: the title cell heads it in 600 weight, every other cell is a line with its
column name on the left and the value on the right. Header cells stay for screen
readers only.

## Elevation & Depth

Flat. Depth comes from tonal layering (canvas, paper, sunk paper) and hairlines.
One shadow exists, for things that float above the page; nothing glows.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 0 0 1px rgb(0 0 0 / 0.08), 0 12px 32px rgb(0 0 0 / 0.12)`;
  dark `0 0 0 1px rgb(255 255 255 / 0.08), 0 16px 40px rgb(0 0 0 / 0.5)`): the command
  palette and the phone drawer, over a 35% black, lightly blurred backdrop.

**The Flat Rule.** Nothing casts a shadow or a glow unless it floats above the page.
Hover answers with a fill change (sunk paper or fill), never light.

## Shapes

Soft, generous corners, as on anthropic.com: 8px on controls, callouts, notices and
tooltips (6px on segmented options and palette rows); 16px on cards, tables, metric
cards, panels and the palette; pills only for count badges; squared stamps for status. Borders are single 1px hairlines.
Secondary buttons and the selected segment use a 1px inset ring rather than a
border. Callouts (AI answers, price suggestions) sit on sunk paper with no border.
A dashed hairline marks something you can see but not change (the read-only note)
and the sign-in story panel's edge and moment cards; working screens have no dashed
rails.

## Components

Calm at rest, a plain answer when touched.

### Buttons
- **Shape:** gently rounded (8px), 36px tall (30px small); 44px (36px small) under 900px.
- **Primary:** solid Ink with Paper text, weight 600; one per view. Hover lifts to
  #3d3d3a; disabled goes to oat with muted text.
- **Secondary:** paper with a strong-hairline ring, weight 500; hover sinks.
  **Ghost:** no fill until hover. **Danger:** red fill for destroying; **Danger
  text:** red words for "Delete" next to other actions.
- **Press / Focus:** all buttons press down 1px; focus is a 2px Info ring offset 3px.
- **Labels:** 1-4 words, starting with a verb or naming the destination.

### Links
Ink-coloured and underlined, the underline at 40% until hover, offset 3px. Text
buttons look the same. Breadcrumbs and table title links drop the underline until
hover.

### Cards / Containers
- **Corner Style:** 8px.
- **Background:** Paper on the canvas.
- **Shadow Strategy:** none (The Flat Rule).
- **Border:** one hairline.
- **Internal Padding:** 16px top, 24px sides and bottom; a sunk footer strip holds
  actions on the right and the save result on the left.

### Setting rows
What a setting is on the left (title, one muted sentence, max 60ch), the control on
the right; rows separated by hairlines; stacked under 640px.

### Inputs / Fields
- **Style:** strong-hairline stroke, paper fill, 6px corners, 36px tall, 15px text.
- **Focus:** Info border plus a 3px soft Info ring. **Disabled:** sunk paper, muted text.
- **Labels:** always visible above the field; placeholders only show an example.
- **Error:** red text under the field saying how to fix it.
- **Switch / checkbox:** checked state is Ink, not orange.

### Navigation
Sidebar rows are 34px (44px in the phone drawer) with a line icon and a 500 label in
muted ink; hover fills and turns ink; the current page gets the orange tint, ember
text and a 3px orange marker on the sidebar edge, with no glow. Count badges are ink
pills with paper text; collapsed, they shrink onto the icon. The command palette
(Ctrl K) is a 620px floating panel with grouped results.

### Badges
Stamps, like a rubber stamp on a stock ticket: 22px, monospace capitals (11px,
0.06em), a 1px outline in the status colour (ok, warn, danger, info, neutral, ink),
3px corners, no tinted fill. The Overview's severity tags and the stock warning use
the same stamp. The words always carry the meaning, never the colour alone.

### Stock tag
The shelf-tag count over a row of 10 printed blocks (both apps): full at twice the
reorder level, a wider gap after the fifth block marking the reorder point, lit
blocks in the stock colour and the rest in Strong Hairline. No rounded bars.

### Data tables
Framed like a card; an optional toolbar strip (search, filters) and footer strip
(pagination); 12px cells (16px at the outer edges), muted 500 headers, hairline
rows, a soft sunk row hover; numbers right-aligned in tabular figures; an empty
table shows an empty state instead of headers; stacks on phones (Layout).

### Today card (signature, Overview)
A plain paper card with generous padding (24px by 32px): one serif sentence about
the day ("No sales yet today."), a muted comparison line under it ("Last Saturday
had €140.00 by this time."), and two quiet ink links with tabular counts
("0 waiting for you", "3 to restock"). Something waiting gets a small Warn dot; the
words still carry the meaning. Links grow to 44px on phones. On the right (below on
phones) a dot-matrix strip of the last 30 days in Ink, unlit dots in Strong
Hairline, captioned "Last 30 days" (`DotMatrix` in the kit).

### Metric card (signature, Reports)
A hairline card with a muted label, an overflow button, a tabular figure, a change
said in words in the status colour ("Much more"), and an edge-to-edge area graph: a
2px Muted Ink line over a halftone area (a 6px dot pattern). No data shows a faint
wave and a small pill.

### Sales chart
Each day a column of dots (6px apart, as many columns as fit the day's width) in
Muted Ink, the active day in Ink; no unlit dots, so values read cleanly; hairline
grid, an ink tooltip with paper text. One keyboard stop, arrow keys walk the days,
and "Show as table" offers the same data as a table.

### Halftone drawing
The four-pillar building drawn in orange dots inside a thin strong-hairline circle,
over an 8px dot field. It appears on sign-in (with floating "shop moment" cards), as
empty-state art (140px), and in the logo. Nowhere else.

### Printed paper (both apps)
The vintage, editorial-print finish, after anthropic.com's textured stock:
- **Paper grain:** a faint fractal-noise layer over the whole dashboard
  (`body::after`, `--grain-*` tokens; 7% multiply on light, 5% screen on dark),
  never taking clicks, off under `prefers-contrast: more` and in print.
- **Double rule:** a 3px double strong hairline under every page title on the
  dashboard; a heavy ink line over a hairline under the team app's masthead.
- **Pixel pictograms** (`pixelDrawings.ts`, identical in both apps and guarded by
  a test): each job drawn in square blocks on a 12 × 12 grid (receipt, clipboard,
  coins, notebook, drop, crate), in ink. Used on the team app's job tiles and on
  empty states for that job (Muted Ink, 40–48px). Decoration only, always beside words.
- **Dithered drawings** (`mobile/src/components/dither.ts`): scenes printed as
  square blocks with 4 × 4 ordered (Bayer) dithering, the grainy look of
  anthropic.com's illustrations. "Shop at sunrise" (the four-pillar shop in Ink
  against a Clay sun, the ground running the width) heads the team app's Today
  panel and sign-in, and sits above the 30-day chart on the dashboard's Today card
  (`ShopSunrise`; the dashboard's `dither.ts` is a copy kept equal by a test).
  Decoration only, hidden from screen readers.
- **Block meter:** progress as a row of 20 printed blocks (Ink, OK once reached),
  with the sentence beside it carrying the meaning.
- **Ruled sections:** on the team app's Home, lists sit under a 2px ink rule and a
  serif heading instead of in boxed cards.

## Do's and Don'ts

### Do:
- **Do** build every page from the kit in `admin/src/components/ui/` (PageHeader,
  Card, SettingRow, DataTable, StatGrid, MetricCard, Badge, Button, Field, EmptyState).
- **Do** use tokens from `admin/src/styles/tokens.css`; mirror changes in
  `mobile/src/theme.ts`.
- **Do** keep Clay for the logo, the drawings and the current menu item; actions are Ink.
- **Do** draw data in ink: series in Muted Ink, the active value in Ink.
- **Do** set page titles in the serif and every figure in tabular Hanken Grotesk.
- **Do** put callouts on sunk paper (`.callout`) instead of framing them.
- **Do** mark phone tables to stack and give every cell its column name.
- **Do** keep touch targets at least 44px on phones.
- **Do** write sentence case, verb-first buttons and errors that say how to fix.
- **Do** wrap motion in `prefers-reduced-motion: no-preference`.

### Don't:
- **Don't** make buttons clay or bright orange.
- **Don't** add glows, corner nodes or dashed rails; keep dots, pictograms and grain-heavy textures out of tables, forms and from behind text.
- **Don't** colour charts, counts, links or badges orange.
- **Don't** add drop shadows to cards or tables.
- **Don't** use the serif for figures, tables, card titles or controls.
- **Don't** use weights above 600 outside the wordmark and count badges, or all-caps labels.
- **Don't** add a second accent colour; status colours are for status only.
- **Don't** let colour alone carry meaning: badges and changes always have words.
