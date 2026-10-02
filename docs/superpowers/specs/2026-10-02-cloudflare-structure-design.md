# 4VD in Cloudflare's design language

The owner asked for the dashboard and the app to follow Cloudflare's UI language
(structure, spacing, buttons, backgrounds, halftones, drawings and colours), built
from a small set of reusable components. 4VD keeps its name, its four-pillar mark
and its own words; only the visual language and the structure change.

## 1. What we took from Cloudflare (notes, 2 Oct 2026)

Studied on cloudflare.com and Kumo (kumo-ui.com, Cloudflare's open component kit).

**Colour**
- One loud colour: orange `#FF5E1F` (their 2026 site). Everything else is warm neutrals.
- Dark: page `#151414`, raised `#191817`, text `#F0E3DE` (warm cream, not white),
  muted text `#9A9390`, lines are the text colour at 12.5% (`rgba(240,227,222,.125)`).
- Light: white surfaces on an almost-white canvas, near-black text, lines at ~10% black.
- Status colours are quiet and semantic: emerald for success, amber for warning,
  red for danger, blue for info and links. Each comes as a strong colour and a
  faint "tint" fill for badges and banners.
- Their orange with white text only reaches 3:1, so for buttons and links we use a
  deeper orange in light mode (`#CC4510`, 4.7:1) and dark text on orange in dark mode.

**Type**
- One grotesk (FT Kunst Grotesk on the site, Inter in the dashboard). Headings are
  medium weight (500–600) with tight tracking (−1.4px at 56px), never heavy.
- Dashboard text sizes: 12 / 13 / 14 (base) / 16. Dense, calm.
- We keep Hanken Grotesk (already ours, close in feel) at 400 / 500 / 600.

**Spacing and shape**
- 4px grid. Gaps used most: 8, 4, 12, 16, 24, 32.
- Controls are 36px tall (30px small) with 12px side padding and 8px corners.
- Cards and tables: 1px hairline border, 8–12px corners, no drop shadow. Shadows only
  on things that float (menus, dialogs): a 1px edge ring plus a soft drop.
- Table cells 12px padding, header row semibold on the surface, one hairline under it.
- Marketing buttons are pills; dashboard buttons are 8px rounded rectangles.

**Buttons** (Kumo variants)
- Primary (filled brand), Secondary (surface with a hairline ring), Ghost (no fill
  until hover), Destructive (filled red). Icon-only square buttons the same height.

**Backgrounds, halftones and drawings**
- Frame rails: the page sits between vertical dashed lines (1px wide, dashes made
  with a 32px repeating gradient, half on half off) with tiny squares at the corners
  where a horizontal rule meets them.
- Halftone: dot-grid fills in the side gutters, and drawings made only of dots
  (their globe is orange dots with thin outline meridians).
- Callouts: boxes marked with orange corner brackets instead of a full border.
- Feature grids: cells share hairline borders (no gaps), each with a line icon,
  a medium-weight title and one muted sentence.
- Hero: one big orange rounded block with a soft radial glow; everything else calm.
- Icons: thin line icons (Phosphor in Kumo).

## 2. How 4VD uses it

- **Palette** (tokens in `admin/src/styles/tokens.css`, mirrored in `mobile/src/theme.ts`):
  orange accent, warm neutrals, the four status colours with tints. Pine and brass go.
- **Mark**: same four pillars and roof; the tile becomes orange, pillars cream,
  roof near-black. All icons regenerate from `brand/make_icons.py`.
- **Shell**: a top bar (mark, shop name, search with Ctrl K, theme, avatar) over a
  left sidebar with line icons and groups; the sidebar can collapse to icons; on
  phones it becomes a drawer opened from the top bar.
- **Pages**: every page starts with a PageHeader (breadcrumb, title, one-line
  description, actions). Content sits in Cards; settings are SettingRows (words left,
  control right) with a footer strip holding Save; lists are DataTables with a toolbar.
- **Overview**: an orange "today" hero with the day's takings, then a feature-style
  StatGrid of figures, then the existing panels as Cards.
- **Decoration**: dashed rails and halftone gutters on the main frame (wide screens
  only), a halftone drawing of the 4VD building on sign-in pages and empty states,
  corner brackets on the AI answer and price suggestion. Reduced motion respected.
- **App**: same palette, type weights and radii; grouped list sections; the same
  Badge and Button variants.

## 3. The component kit (`admin/src/components/ui/`)

Only what pages reuse: `Button`/`ButtonLink`, `PageHeader`, `Card`, `SettingRow`,
`DataTable`, `StatGrid`/`StatTile`, `Badge`, `Field`, `EmptyState`, `Halftone`, `Icon`
re-exports. Styles live next to them in `ui.css`. Page-specific styles stay in
`styles/pages.css` and use only tokens.

## 4. Done means

- Both themes pass the contrast test with the new tokens.
- Every dashboard page uses PageHeader and the kit; no page keeps its own copy of
  a button, card, table or badge style.
- Checked by screenshot in light and dark, at desktop and phone width.
- All existing tests pass; new kit components have render tests.
