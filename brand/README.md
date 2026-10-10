# 4VD brand

**4VD** is "4 Vëllezërit Dacaj", the four Dacaj brothers. Their father named the
family shop after them.

## The mark

The shop at sunrise (`logo-mark.svg`): four equal pillars under one roof, the
four brothers holding up the family home and shop, with a clay sun rising behind
them, on an ivory tile. The pillars are the same size on purpose; nobody is
bigger. It uses the same shapes as the sign-in drawing.

- Use `logo-mark.svg` on its own for icons, favicons and small spaces.
- Use `logo-full.svg` (mark + "4VD") where there is room for the name.
- Keep the mark's colours: ink `#141413`, clay `#D4704F`, ivory `#FAF9F5`.
- Don't stretch it, outline it, add shadows, or tell the four-brothers story
  in the interface. It's there for people who ask.
- The app icons are drawn from the SVG: run `node brand/make_icons.mjs` after
  changing it (needs `npm install` in `backend/` for sharp). Android's themed
  icon uses the ink shapes alone. The dashboard's icons (tab and home screen)
  are the same mark inverted, an ink tile with an ivory shop, so the two apps
  never look alike side by side. Then bump `?v=` on the icon links in
  `admin/index.html`, `mobile/public/index.html` and both `manifest.json` files,
  or browsers keep showing the old icon.

## Look, colours and type

Everything about how 4VD looks, reads and works (colours, type, buttons, glass,
the printed finish, wording) lives in one rulebook: [`DESIGN.md`](../DESIGN.md)
in the project root. The values are in `admin/src/styles/tokens.css` and
`mobile/src/theme.ts`. This file only covers the logo and icon files.

## Icons

Line icons from Phosphor in the dashboard. `node brand/make_icons.mjs` redraws
the PNG app icons in `mobile/` from `logo-mark.svg`.
