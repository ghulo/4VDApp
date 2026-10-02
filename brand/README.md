# 4VD brand

**4VD** is "4 Vëllezërit Dacaj", the four Dacaj brothers. Their father named the
family shop after them.

## The mark

Four equal pillars under one roof (`logo-mark.svg`): the four brothers holding up
the family home and shop. The pillars are the same size on purpose; nobody is
bigger. The roof is near-black and the pillars cream, on orange.

- Use `logo-mark.svg` on its own for icons, favicons and small spaces.
- Use `logo-full.svg` (mark + "4VD") where there is room for the name.
- Keep the mark's colours. On an orange background, drop the rounded square
  and use the roof and pillars alone.
- Don't stretch it, outline it, add shadows, or tell the four-brothers story
  in the interface. It's there for people who ask.

## Look and feel

The visual language follows Cloudflare's (notes in
`docs/superpowers/specs/2026-10-02-cloudflare-structure-design.md`): one loud
orange on warm neutrals, hairline frames with small corner squares, halftone
dots, drawings made of dots, dashed rails, and a soft orange glow on what
matters. Motion is quick and quiet, and off when the computer asks for less.

## Colours

| Name | Light | Dark | Meaning |
|---|---|---|---|
| Orange (accent, buttons) | `#FF5E1F` | `#FF5E1F` | the one loud colour: main buttons, the today block, where you are |
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

Line icons from Phosphor in the dashboard. `python brand/make_icons.py` redraws
the PNG app icons in `mobile/` from the same geometry as the SVG.
