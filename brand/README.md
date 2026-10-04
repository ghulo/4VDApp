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

## Look and feel

The visual language follows Cloudflare's (notes in
`docs/superpowers/specs/2026-10-02-cloudflare-structure-design.md`): one loud
orange on warm neutrals, hairline frames with small corner squares, halftone
dots, drawings made of dots, dashed rails, and a soft orange glow on what
matters. Motion is quick and quiet, and off when the computer asks for less.

## Colours

| Name | Light | Dark | Meaning |
|---|---|---|---|
| Clay (brand) | `#D4704F` | `#D4704F` | the brand colour: the logo, illustrations and where you are (main buttons are solid ink) |
| Orange text (brand) | `#C2410C` | `#FF7038` | links and orange words (darker in light mode so it reads) |
| Ink | `#1F1B19` | `#F2EBE7` | text, and the text on orange |
| Warn | `#B45309` | `#FBBF24` | low stock, waiting for you |
| Danger | `#B91C1C` | `#F87171` | sold out, urgent, delete |
| OK | `#047857` | `#34D399` | in stock, approved |
| Info | `#1D4ED8` | `#60A5FA` | ideas, focus rings |

Text on orange is always near-black (`#1C0F08`): white on this orange is too
faint to read. Neutrals are warm greys; the full set is in
`admin/src/styles/tokens.css` and `mobile/src/theme.ts`.

## Type

Hanken Grotesk: 400 for reading, 500 for controls, 600 for headings and big
figures, with tight letter spacing on large sizes. Numbers use tabular figures
so columns line up.

## Icons

Line icons from Phosphor in the dashboard. `node brand/make_icons.mjs` redraws
the PNG app icons in `mobile/` from `logo-mark.svg`.
