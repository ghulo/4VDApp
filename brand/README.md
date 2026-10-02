# 4VD brand

**4VD** is "4 Vëllezërit Dacaj", the four Dacaj brothers. Their father named the
family shop after them.

## The mark

Four equal pillars under one roof (`logo-mark.svg`): the four brothers holding up
the family home and shop. The pillars are the same size on purpose; nobody is
bigger. The roof is brass, the pillars white, on pine green.

- Use `logo-mark.svg` on its own for icons, favicons and small spaces.
- Use `logo-full.svg` (mark + "4VD") where there is room for the name.
- Keep the mark's colours. On a pine-green background, drop the rounded square
  and use the roof and pillars alone.
- Don't stretch it, outline it, add shadows, or tell the four-brothers story
  in the interface. It's there for people who ask.

## Colours

| Name | Light | Dark | Meaning |
|---|---|---|---|
| Pine (brand) | `#1D5C45` | `#5BBF92` | main actions, links, where you are |
| Deep pine | `#123B2D` | `#0B231A` | the big-figure boards |
| Brass | `#B8862B` | `#D9A945` | highlights, the roof |
| Warn | `#B36B00` | `#F0A73A` | low stock, waiting for you |
| Danger | `#B83A2B` | `#F07563` | sold out, urgent, delete |
| OK | `#2F7D55` | `#6CC795` | in stock, approved |

Neutrals are slightly green-tinted greys; see `admin/src/index.css` for the full set.

## Type

Hanken Grotesk: 400 for reading, 600 for controls and labels, 800 for headings
and big figures. Numbers use tabular figures so columns line up.

## Icons

`python brand/make_icons.py` redraws the PNG app icons in `mobile/public/` from
the same geometry as the SVG.
