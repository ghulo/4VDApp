---
name: 4VD
description: The Dacaj family shop's stock, sales and team, in one precise, quiet interface with one orange voice.
colors:
  signal-orange: "#ff5e1f"
  signal-orange-hover: "#ff7038"
  ember-text: "#c2410c"
  ember-text-dark: "#ff7038"
  pillar-ink: "#1c0f08"
  warm-canvas: "#faf9f7"
  paper: "#ffffff"
  sunk-paper: "#f4f2ef"
  fill: "#efece8"
  ink: "#1f1b19"
  ink-muted: "#6b635f"
  hairline: "#ebe7e3"
  hairline-strong: "#d9d3ce"
  night-canvas: "#151414"
  night-paper: "#1c1b1a"
  night-ink: "#f2ebe7"
  night-muted: "#9a9390"
  ok: "#047857"
  warn: "#b45309"
  danger: "#b91c1c"
  info: "#1d4ed8"
typography:
  display:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "clamp(2.75rem, 6vw, 4rem)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  hairline: "2px"
  control: "8px"
  card: "12px"
  board: "16px"
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
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  button-ghost:
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
  badge:
    rounded: "{rounded.pill}"
    typography: "{typography.label}"
    height: "22px"
  today-board:
    backgroundColor: "{colors.signal-orange}"
    textColor: "{colors.pillar-ink}"
    rounded: "{rounded.hairline}"
---

# Design System: 4VD

## Overview

**Creative North Star: "Four Pillars"**

Four equal pillars hold up one roof: the four Dacaj brothers holding up the family
shop. The interface carries that idea as structure and fairness. Everything sits in
hairline frames that meet at small square corner nodes; columns are equal; nothing
is bigger, louder or heavier than its job needs. The language comes from
Cloudflare's interface (warm neutrals, halftone dots, drawings made of dots, dashed
rails, a rich orange used sparingly, a soft neon glow) and the rigour from the SBB
design system (reduced content, plain words, responsive spacing, generous touch
sizes).

It is a working tool for a shop counter, not a showroom. Density is calm and
scannable; the page is quiet until you point at something, then it answers with a
small glow or a quick transition. Orange is the shop's one voice: it marks the
main action, where you are, and the day's takings, and almost nothing else.

**Key Characteristics:**
- Hairline frames with corner nodes; flat surfaces, no drop shadows at rest.
- One orange voice (`#ff5e1f`) on warm neutrals, with near-black text on it.
- Halftone dots as texture and as data (dot-matrix charts, dotted drawings).
- Medium-weight type with tight tracking on large sizes; never heavy.
- Quick, soft motion (150ms, gentle ease-out); off when the computer asks for less.
- Both themes are first-class; dark is warm (`#151414`), not blue-black.

## Colors

One loud colour on warm, slightly beige neutrals; status colours stay quiet and
come with faint tints.

### Primary
- **Signal Orange** (#ff5e1f): primary buttons, the today board, the active menu
  marker, badges with counts, chart dots, the logo tile. Text on it is Pillar Ink.
- **Ember Text** (#c2410c light / #ff7038 dark): orange words and links, where the
  full Signal Orange would be too faint to read on white.

### Neutral
- **Warm Canvas** (#faf9f7) / **Night Canvas** (#151414): the page behind frames.
- **Paper** (#ffffff) / **Night Paper** (#1c1b1a): cards, tables, the top bar.
- **Sunk Paper** (#f4f2ef): card footer strips, hover rows, inputs at rest in wells.
- **Ink** (#1f1b19) / **Night Ink** (#f2ebe7, warm cream): text.
- **Muted Ink** (#6b635f) / **Night Muted** (#9a9390): descriptions, labels, meta.
- **Hairline** (#ebe7e3) and **Strong Hairline** (#d9d3ce): every border, rails,
  corner nodes, unlit dots.
- **Pillar Ink** (#1c0f08): text and drawings on Signal Orange.

### Status
- **OK** (#047857), **Warn** (#b45309), **Danger** (#b91c1c), **Info** (#1d4ed8),
  each with a faint tint for badge and banner fills; brighter variants in dark mode.

### Named Rules
**The One Voice Rule.** Signal Orange covers well under a tenth of any screen. If
two things on a page are orange, one of them is wrong.

**The Dark Text On Orange Rule.** Text on Signal Orange is always Pillar Ink.
White on this orange reaches only 3:1 and fails reading contrast.

## Typography

**Display Font:** Hanken Grotesk (with system-ui)
**Body Font:** Hanken Grotesk (with system-ui)

**Character:** One grotesk at four weights (400 read, 500 controls, 600 headings and
figures, 700 only for the wordmark). Large sizes tighten their tracking so figures
feel engineered rather than shouted.

### Hierarchy
- **Display** (600, clamp(2.75rem, 6vw, 4rem), 1): the day's takings on the today
  board. Digits roll into place once.
- **Headline** (600, 1.75rem, 1.15): page titles, one per page.
- **Title** (600, 1rem, 1.4): card titles.
- **Body** (400, 0.875rem, 1.5): everything else in the dashboard; descriptions
  under titles are 1rem and muted, max 68ch.
- **Label** (600, 0.8125rem): field labels, table headers (500, muted), badges
  (0.75rem).

### Named Rules
**The No Shouting Rule.** No weight above 600 outside the wordmark, no all-caps
labels, sentence case everywhere.

**The Tabular Rule.** Every number that can sit in a column uses tabular figures.

## Layout

A top bar (56px, see-through with blur) spans the page; a 232px icon sidebar sits
under it on the left and collapses to 60px icons only; on phones (under 900px) it
becomes a drawer opened from the top bar. The page lives in a frame of at most
1200px between dashed vertical rails, over a halftone dot field that fills the
gutters on wide screens.

Spacing runs on a 4px grid (4, 8, 12, 16, 24, 32, 48). Page padding steps down
with the screen, after SBB's responsive spacing: 32/48px on desktop, 32/24px under
1100px, 24/16px on phones. Every page opens with the same header (breadcrumb,
title, one-line description, actions on the right), then cards stacked 16px apart.
Two related cards may sit side by side and stack under 960px.

**The Same Header Rule.** Every page starts with the shared page header. No page
invents its own title block.

## Elevation & Depth

Flat by default. Depth comes from tonal layering (canvas, paper, sunk paper) and
hairlines, not shadows. Shadows exist only for things that float above the page.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 0 0 1px rgb(0 0 0 / 0.08), 0 12px 32px rgb(0 0 0 / 0.12)`):
  the command palette and the phone drawer.
- **Glow** (`box-shadow: 0 0 0 1px rgb(255 94 31 / 0.35), 0 0 18px rgb(255 94 31 / 0.28)`):
  a primary button under the pointer. Also used as a 10px orange halo on the
  active menu marker and count badges, and as a text glow on highlighted phrases.
- **Board halo** (`box-shadow: 0 0 60px -20px rgb(255 94 31 / 0.55)`): the today
  board only.

**The Flat-At-Rest Rule.** Nothing casts a shadow until it floats or is pointed at.

## Shapes

Small, consistent corners: 8px on controls, 12px on cards and tables, 2px on the
framed blocks that carry corner nodes (the today board and stat strips), pills
only for badges and status chips. Corner nodes are 7px filled squares sitting on
the four corners of a framed block. Callouts (AI answers, price suggestions) use
orange corner brackets instead of a full border. Dashed lines mark rails, empty
connections and the decorative "shop moment" cards.

## Components

Precise and quiet: calm at rest, a soft response when touched.

### Buttons
- **Shape:** gently rounded (8px), 36px tall (30px small); 44px on phones.
- **Primary:** Signal Orange with Pillar Ink text, weight 600; one per view.
- **Hover / Focus:** primary brightens and glows; all buttons ease colour and
  shadow over 150ms and press down 1px; focus shows a 2px blue ring offset 2px.
- **Secondary:** paper with a hairline ring; **Ghost:** no fill until hover;
  **Danger:** red fill for destroying; **Danger text:** red words for "Delete"
  next to other actions.
- **Labels:** 1–4 words, starting with a verb or naming the destination
  ("Save changes", "Add product", "Go to categories").

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** Paper on the canvas.
- **Shadow Strategy:** none (Flat-At-Rest).
- **Border:** one hairline.
- **Internal Padding:** 16px top, 24px sides and bottom; a sunk footer strip holds
  Save on the right and the save result on the left.

### Setting rows
What a setting is on the left (title, one muted sentence), the control on the
right; rows separated by hairlines; stacked on phones.

### Inputs / Fields
- **Style:** hairline-strong stroke, paper fill, 8px corners, 36px tall.
- **Focus:** blue border plus a 3px soft blue ring.
- **Labels:** always visible above the field; placeholders only show an example
  or format, never replace the label.
- **Error:** red text under the field saying how to fix it.

### Navigation
Sidebar items are 34px rows with a line icon and a medium label; hover fills
softly; the current page gets an orange tint, orange text and a glowing 3px orange
marker on the sidebar edge. Count badges are orange pills.

### Badges
Pill, 22px, tinted fill with strong text in the status colour (ok, warn, danger,
info, brand, neutral). The words always carry the meaning, never the colour alone.

### Data tables
Framed like a card; an optional toolbar strip on top (search, filters) and footer
strip (pagination); 12px cells, muted medium headers, hairline rows, a soft row
hover; numbers right-aligned in tabular figures; an empty table shows an empty
state instead of headers.

### Today board (signature)
A Signal Orange block with a warm radial glow, square-ish corners and corner
nodes: the day's takings rolling in, a dot-matrix waveform of the last 30 days,
two pill links (waiting, to restock) and a status pill on a dotted line across
the bottom.

### Dot-matrix chart (signature)
Bars drawn as columns of dots: lit orange dots for the value, faint dots filling
the empty room above. Each column is a focusable target with a tooltip and a
"Show as table" alternative.

### Halftone drawing (signature)
The four-pillar building drawn only in dots inside a thin circle, with a fading
dot field; on sign-in pages it is surrounded by dashed "shop moment" cards.

## Do's and Don'ts

### Do:
- **Do** build every page from the kit in `admin/src/components/ui/` (PageHeader,
  Card, SettingRow, DataTable, StatGrid, Badge, Button, Field, EmptyState).
- **Do** use tokens from `admin/src/styles/tokens.css`; mirror changes in
  `mobile/src/theme.ts`.
- **Do** keep Signal Orange for the one main action and live status.
- **Do** put text on orange in Pillar Ink (#1c0f08).
- **Do** keep touch targets at least 44px on phones.
- **Do** write sentence case, verb-first buttons and errors that say how to fix.
- **Do** wrap motion in `prefers-reduced-motion: no-preference`.

### Don't:
- **Don't** put white text on Signal Orange.
- **Don't** add drop shadows to cards or tables.
- **Don't** use weights above 600 outside the wordmark, or all-caps labels.
- **Don't** add a second accent colour; status colours are for status only.
- **Don't** paint CSS gradients across tall areas (dot fields go on fixed,
  screen-sized layers or tiny repeated SVGs).
- **Don't** let colour alone carry meaning: badges and tags always have words.
