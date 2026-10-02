# Design System (part 1 of the rebrand) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give both apps the new 4VD identity (four-pillar logo, pine and brass palette, Hanken Grotesk) with a light / dark / system theme switch, applied to the shared shell and components so every existing screen picks it up.

**Architecture:** Colour tokens live in one place per app: CSS custom properties in `admin/src/index.css` (switched by `data-theme` on `<html>`), and a typed token object in `mobile/src/theme.ts` (switched by a `ThemeProvider`). Old token names in the admin stylesheet become aliases of the new ones, so every page restyles at once and later parts can rename gradually. The theme preference is stored locally now and moves into the profile in part 2.

**Tech Stack:** React 19 + Vite + plain CSS (admin), React Native / Expo 57 + react-native-web (mobile), Vitest, Python + Pillow for raster icons.

**Spec:** `docs/superpowers/specs/2026-10-02-rebrand-accounts-design.md` (section 1)

## Global Constraints

- Typeface: Hanken Grotesk only — 400 body, 600 UI, 800 headings and big figures; tabular figures for numbers.
- Tokens (light / dark): bg `#F3F5F2`/`#0D1411`, surface `#FFFFFF`/`#151F1A`, surface-sunk `#E9EDE8`/`#0A100D`, ink `#122019`/`#E6EEE9`, ink-muted `#55665D`/`#97A89F`, line `#D9E0DA`/`#26332C`, brand `#1D5C45`/`#5BBF92`, brand-ink `#FFFFFF`/`#08130E`, brass `#B8862B`/`#D9A945`, warn `#B36B00`/`#F0A73A`, danger `#B83A2B`/`#F07563`, ok `#2F7D55`/`#6CC795`.
- Extra token `brand-deep` `#123B2D`/`#0B231A` for the big-figure boards (white text on it in both themes).
- Radius 8 / 14 / 20, pills for tags; 4 px spacing grid; borders over shadows.
- Themes: `light`, `dark`, `system` (default).
- Sentence case everywhere; no all-caps labels; no "A · B" separators.
- Text contrast WCAG AA: 4.5:1 for body text, 3:1 for large text and UI parts.
- Motion only in answer to an action; respect `prefers-reduced-motion`.

## Review Focus

- Theme preference stored as junk or blocked storage (private window) → falls back to `system` without crashing (test in Task 3 and Task 5).
- System theme changes while the app is open → follows it when the preference is `system` (test in Task 3).
- A brand colour pair fails contrast in one theme → caught by the token contrast test (Task 2).
- Text on the brand colour (primary buttons) unreadable in dark mode → `brand-ink` pair in the contrast test (Task 2).
- The page flashes the wrong theme before React loads → inline script in `index.html` sets `data-theme` first (Task 3).

---

### Task 1: Logo and icons

**Files:**
- Create: `brand/logo-mark.svg`, `brand/logo-full.svg`, `brand/README.md`, `brand/make_icons.py`
- Modify: `admin/public/favicon.svg`; `mobile/public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`; `mobile/public/manifest.json`; `mobile/public/index.html`

**Interfaces:** Produces `brand/logo-mark.svg` (64×64 viewBox) used inline by later tasks as `<LogoMark />`.

- [ ] **Step 1:** Draw the mark: rounded square (radius 14 of 64) filled `#1D5C45`; a brass roof bar (`#D9A945`) across the top; four equal white pillars beneath it with equal gaps, sitting on a thin base line. Save as `brand/logo-mark.svg`; `logo-full.svg` adds the "4VD" wordmark (Hanken Grotesk 800) to its right.
- [ ] **Step 2:** `brand/make_icons.py` draws the same geometry with Pillow at 180/192/512 px (and a maskable 512 with 20 % padding on a full-bleed green background) into `mobile/public/`.
- [ ] **Step 3:** Run `python brand/make_icons.py`, open the 192 px icon to check the pillars stay distinct.
- [ ] **Step 4:** Copy the mark to `admin/public/favicon.svg`; set `theme_color`/`background_color` in `manifest.json` and `theme-color` in `mobile/public/index.html` to `#1D5C45`.
- [ ] **Step 5:** `brand/README.md`: what the mark means (four equal pillars, the four Dacaj brothers holding up the shop), colours, type, do/don't. Commit: `feat: Add the new 4VD logo and app icons`.

### Task 2: Dashboard tokens, type and contrast test

**Files:**
- Modify: `admin/index.html` (fonts), `admin/src/index.css` (tokens at the top)
- Create: `admin/src/theme/contrast.ts`, `admin/src/theme/contrast.test.ts`

**Interfaces:** Produces CSS variables `--bg --surface --surface-sunk --ink --ink-muted --line --line-strong --brand --brand-ink --brass --warn --danger --ok --focus`, plus aliases `--concrete=var(--bg) --steel=var(--ink-muted) --signal-low=var(--warn) --signal-low-ink=var(--warn) --signal-out=var(--danger) --stock-ok=var(--ok) --board=var(--brand-deep)`. `contrastRatio(hexA: string, hexB: string): number`.

- [ ] **Step 1: Write the failing test** — `contrast.test.ts` reads `index.css`, extracts the light block (`:root, [data-theme='light']`) and dark block (`[data-theme='dark']`), and asserts for each theme: ink/bg ≥ 4.5, ink/surface ≥ 4.5, ink-muted/surface ≥ 4.5, brand-ink/brand ≥ 4.5, danger/surface ≥ 4.5, warn/surface ≥ 3, ok/surface ≥ 3, brand/surface ≥ 3.
- [ ] **Step 2:** Run `npm test` in `admin` — fails (no tokens, no helper).
- [ ] **Step 3:** Implement `contrastRatio` (WCAG relative luminance) and write the token blocks with the spec's values; swap the Google Fonts link to `Hanken+Grotesk:wght@400;600;800`; `--font-body` and `--font-display` both `'Hanken Grotesk'`.
- [ ] **Step 4:** Run the test; adjust any token that fails by darkening (light) or lightening (dark) until it passes, and note the change in the spec table.
- [ ] **Step 5:** Commit: `feat: Switch the dashboard to the new colours and typeface`.

### Task 3: Dashboard theme switch

**Files:**
- Create: `admin/src/theme/theme.ts`, `admin/src/theme/theme.test.ts`, `admin/src/theme/ThemeSwitch.tsx`
- Modify: `admin/index.html` (inline pre-paint script), `admin/src/components/Layout.tsx`, `admin/src/pages/LoginPage.tsx`

**Interfaces:** `type ThemePreference = 'light' | 'dark' | 'system'`; `readPreference(storage: Pick<Storage,'getItem'> | null): ThemePreference`; `resolveTheme(pref: ThemePreference, systemDark: boolean): 'light' | 'dark'`; `applyTheme(pref: ThemePreference): void` (sets `document.documentElement.dataset.theme`, saves to `localStorage['4vd.theme']`); `useThemePreference(): [ThemePreference, (p: ThemePreference) => void]` which re-applies on system changes.

- [ ] **Step 1: Failing tests** — `readPreference` returns `system` for missing, junk, or throwing storage; `resolveTheme('system', true) === 'dark'`; `resolveTheme('light', true) === 'light'`.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Implement; inline script in `index.html` runs the same read/resolve before the stylesheet paints; `ThemeSwitch` is a three-option segmented control (Light / Dark / Auto) in the sidebar footer and on the login card.
- [ ] **Step 4:** Tests pass; `npm run build` and `npm run lint` clean.
- [ ] **Step 5:** Commit: `feat: Let people choose a light, dark or automatic theme on the dashboard`.

### Task 4: Dashboard shell and components restyled

**Files:**
- Create: `admin/src/components/LogoMark.tsx`
- Modify: `admin/src/index.css` (shell, buttons, fields, cards, tables, tags, board, login), `admin/src/components/Layout.tsx`, `admin/src/pages/LoginPage.tsx`, `admin/src/pages/OverviewPage.tsx`

- [ ] **Step 1:** Sidebar: surface-coloured (not a dark slab), logo mark + wordmark at top, group labels in ink-muted, active item = brand-tinted pill with brand text and a brass dot; badges brass on brand-ink.
- [ ] **Step 2:** Buttons: primary brand/brand-ink radius 8 height 44; secondary surface with line border; quiet; danger. Fields: 44 px, radius 8, focus ring `--focus`. Cards/panels radius 14, border `--line`, no shadow. Tables: sunk header, tabular numbers. Tags: pills.
- [ ] **Step 3:** Today board: brand-deep green board, radius 20, big figure 88 px weight 800, brass rule instead of the yellow edge; tags brass when "on".
- [ ] **Step 4:** Login: split screen on wide screens (brand panel with the logo and the four-brothers line in small print; form on the right), single column on phones.
- [ ] **Step 5:** Screenshot Overview, Products, Reports, Login in both themes at 1389 px and 390 px; fix anything off; `npm run build`, `lint`, `test` clean. Commit: `feat: Restyle the dashboard shell and components in the new identity`.

### Task 5: Employee app tokens, font and theme provider

**Files:**
- Modify: `mobile/src/theme.ts`, `mobile/src/App.tsx`, `mobile/package.json` (add `@expo-google-fonts/hanken-grotesk`, remove Barlow packages)
- Create: `mobile/src/theme/ThemeProvider.tsx`

**Interfaces:** `ThemeColors` keys: `background surface surfaceSunk ink inkMuted line brand brandInk brass warn danger ok` plus aliases kept for existing screens (`steel=inkMuted`, `signalLow=warn`, `signalLowInk=warn`, `signalOut=danger`, `stockOk=ok`, `lineStrong`, `onInk=brandInk`, `heroInk=brandDeep`, `heroRaised`, `heroText`, `heroMuted`). `useThemeColors(): ThemeColors` (now reads the provider), `useThemePreference(): [ThemePreference, (p) => void]`; preference saved with `secureStorage` key `4vd.theme`; `fonts` keys unchanged (`body`, `bodyBold`, `display`, `displayBold`) mapped to Hanken Grotesk 400/600/800/800.

- [ ] **Step 1:** Install the font package (`npx expo install @expo-google-fonts/hanken-grotesk`), load weights 400/600/800 in `App.tsx`.
- [ ] **Step 2:** Write the provider: reads the saved preference (junk or unreadable → `system`), follows `useColorScheme()` when `system`.
- [ ] **Step 3:** Replace the token objects with the spec values; `npx tsc --noEmit` clean.
- [ ] **Step 4:** Commit: `feat: Switch the employee app to the new colours and typeface, with a theme setting`.

### Task 6: Employee app shell restyled

**Files:**
- Create: `mobile/src/components/LogoMark.tsx` (react-native-svg is not installed, so draw the mark with Views)
- Modify: `mobile/src/navigation/RootNavigator.tsx`, `mobile/src/screens/LoginScreen.tsx`, `mobile/src/screens/HomeScreen.tsx`, `mobile/src/screens/AccountScreen.tsx`, `mobile/src/components/ui.tsx`

- [ ] **Step 1:** Tab bar: surface with a top border, brand-coloured active label and a small brass dot above it.
- [ ] **Step 2:** Home board: brand-deep green, radius 20 inset from the screen edge, big figure 72 px weight 800, brass target bar.
- [ ] **Step 3:** Login: logo mark, wordmark, the form on a surface card; brand background in both themes.
- [ ] **Step 4:** Account: a "Theme" choice row (Light / Dark / Auto).
- [ ] **Step 5:** Run the web build locally, screenshot Login, Home, Products, Account in both themes; fix; commit: `feat: Restyle the employee app shell in the new identity`.

### Task 7: Ship

- [ ] **Step 1:** Push a branch, wait for the GitHub checks, merge to `main`, push, delete the branch.
- [ ] **Step 2:** Confirm Render redeployed the dashboard and employee app (new favicon and theme switch visible).
