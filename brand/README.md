# 4VD brand

**4VD** is "4 Vëllezërit Dacaj", the four Dacaj brothers. Their father named the
family shop after them.

## The logo

Chosen 2026-10-20. It says who we are, not what we sell, so it still fits if 4VD grows
beyond the shop.

- **The wordmark** (`logo-full.svg`, `Wordmark` in `admin/src/components/LogoMark.tsx`):
  an open 4, the V drawn as a tick, a D. One stroke weight with round ends. The tick
  means "done right, you can count on us". Letters in ink (light text on dark), the tick
  in amber. Used in the dashboard's top bar, sign-in and the download page.
- **The mark** (`logo-mark.svg`, `LogoMark`): the tick alone, ink on a solid amber
  tile. The tile makes it read the same on light and dark. Used for app icons, the
  favicon, the Windows app, emails, the Counter bar and the loading screen. Printed
  documents use an ivory tile instead (`backend/src/services/documents/shopMark.ts`).
- Don't put the tick mark right next to the wordmark: that's two ticks in a row.
- Keep the colours: ink `#141413`, amber `#F5B71A`. Don't stretch it, outline it or add shadows.
- The app icons and the email logo are drawn from the SVG: run `node brand/make_icons.mjs`
  after changing it (needs `npm install` in `backend/` for sharp), then
  `node desktop/build/make_installer_art.mjs` for the installer pictures. Copy
  `logo-mark.svg` to `desktop/src/mark.svg`. Then bump `?v=` on the icon links in
  `admin/index.html` and `admin/public/manifest.json` (and `?v=` on `LOGO_URL` in
  `backend/src/services/email/templates.ts`), or browsers keep showing the old icon.
  The script also redraws the retired team app's icons; leave those out of commits.
- The shop-at-sunrise drawing (`ShopSunrise`) is an illustration, not the logo.

## Look, colours and type

Everything about how 4VD looks, reads and works (colours, type, buttons, glass,
the printed finish, wording) lives in one rulebook: [`DESIGN.md`](../DESIGN.md)
in the project root. The values are in `admin/src/styles/tokens.css` and
`mobile/src/theme.ts`. This file only covers the logo and icon files.

## Icons

Line icons from Phosphor in the dashboard. `node brand/make_icons.mjs` redraws
the PNG app icons from `logo-mark.svg`.
