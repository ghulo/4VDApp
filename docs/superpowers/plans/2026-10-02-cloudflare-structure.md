# Cloudflare-style structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the dashboard and app look on Cloudflare's design language with a small reusable component kit.

**Architecture:** Split `admin/src/index.css` into layered files (tokens, base, decor, shell, kit, pages). Add a component kit in `admin/src/components/ui/` and move every page onto it. Mirror tokens in the Expo app.

**Tech Stack:** React 19 + Vite + Vitest (render tests with `react-dom/server`), `@phosphor-icons/react`; Expo.

**Spec:** `docs/superpowers/specs/2026-10-02-cloudflare-structure-design.md`

## Global Constraints

- Contrast: reading text 4.5:1, UI parts and large text 3:1, in both themes (contrast test).
- Controls 36px (30px small), 8px corners; cards 12px corners, hairline borders, no shadows except floating layers.
- Sentence case, no all-caps labels, no "A · B" separators. Phone width with a 16px gutter and no sideways scroll.
- Decoration hidden under 1100px wide where it would crowd; motion respects reduced motion.

## Review Focus

- Sidebar collapsed, then page reload → stays collapsed (localStorage, try/catch).
- Phone width → drawer opens and closes, focus goes back to the menu button, Esc closes.
- DataTable with zero rows → shows the empty state, not an empty header.
- Buttons rendered as links (`ButtonLink`) keep keyboard focus styles.
- Dark mode → orange buttons use dark text (contrast).

---

### Task 1: Tokens, layers, mark
- [ ] Split CSS into `styles/{tokens,base,decor,shell,pages}.css` + `components/ui/ui.css`, imported by `index.css`; new palette; contrast test reads `styles/tokens.css` and checks accent pairs.
- [ ] New mark colours in `LogoMark` (both apps), `brand/*.svg`, favicon, `make_icons.py` → regenerate icons. Commit.

### Task 2: Component kit
- [ ] Render tests first (`components/ui/ui.test.tsx`): Button variants and link form, PageHeader crumbs and actions, Card footer, SettingRow, DataTable rows and empty, Badge tones, StatTile, EmptyState.
- [ ] Implement the kit and `ui.css`. Commit.

### Task 3: App shell
- [ ] Top bar + icon sidebar + collapse + phone drawer; decor rails/halftone around main. Commit.

### Task 4: Pages onto the kit
- [ ] Lists: Products, Inventory, Sales, Categories, Promotions, People, Activity, Alerts, Approvals, Counts.
- [ ] Detail and forms: ProductForm, InventoryDetail, StockCountDetail.
- [ ] Settings-like: Settings, Business, Profile, Push settings.
- [ ] Overview (hero + StatGrid + cards), Reports, Ask; auth pages with halftone drawing. Commit per group.
- [ ] Delete old generic CSS no page uses.

### Task 5: App
- [ ] Palette, weights, radii in `mobile/src/theme.ts`; Button variants; section lists; check screens. Commit.

### Task 6: Ship
- [ ] Screens in both themes and phone width; docs; checks green; merge, push.
