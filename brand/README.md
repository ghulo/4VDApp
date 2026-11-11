# 4VD brand

**4VD** is "4 Vëllezërit Dacaj", the four Dacaj brothers. Their father named the
family shop after them.

## The logo

Chosen 2026-11-11 (replaced the tick, which read as "done" and said nothing about care).
4VD treats customers like family, so the mark is a home.

- **The mark** (`logo-mark.svg`, `LogoMark` in `admin/src/components/LogoMark.tsx`): a
  hand-drawn house, four equal arched doorways (the four brothers, nobody bigger) under
  one soft roof with a chimney, on a gentle ground line, on a soft amber tile. Ink on
  amber, the same on light and dark. Traced from `logo-source.webp` (the image the user
  chose), so the hand-drawn wobble is on purpose: don't straighten it.
  The paths live in `admin/src/components/logoPaths.ts` for the dashboard, and in
  `backend/src/services/documents/shopMark.ts` (ivory tile, for print).
- **No letters** (2026-11-11): the mark stands alone everywhere, no "4VD" beside it; it
  replaced the wordmark. Sizes: 46px in the top bar, 128px on sign-in, 96px while
  signing in, 40px on the Counter.
- Keep the colours: ink `#141413`, amber `#F5B71A`. Don't stretch it, outline it or add shadows.
- The app icons and the email logo are drawn from the SVG: run `node brand/make_icons.mjs`
  after changing it (needs `npm install` in `backend/` for sharp), then
  `node desktop/build/make_installer_art.mjs` for the installer pictures. Copy
  `logo-mark.svg` to `desktop/src/mark.svg` and update `logoPaths.ts` and `shopMark.ts`.
  Then bump `?v=` on the icon links in `admin/index.html` and
  `admin/public/manifest.json` (and `?v=` on `LOGO_URL` in
  `backend/src/services/email/templates.ts`), or browsers keep showing the old icon.
  The script also redraws the retired team app's icons; leave those out of commits.
- `ShopSunrise` draws the mark large (sign-in, empty pages).

## Look, colours and type

Everything about how 4VD looks, reads and works (colours, type, buttons, glass,
the printed finish, wording) lives in one rulebook: [`DESIGN.md`](../DESIGN.md)
in the project root. The values are in `admin/src/styles/tokens.css` and
`mobile/src/theme.ts`. This file only covers the logo and icon files.

## Icons

Line icons from Phosphor in the dashboard. `node brand/make_icons.mjs` redraws
the PNG app icons from `logo-mark.svg`.
