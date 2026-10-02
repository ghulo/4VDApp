"""Draw the 4VD mark as PNG app icons (same geometry as logo-mark.svg).

Run from the repo root: python brand/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ORANGE = (255, 94, 31)
INK = (28, 15, 8)
CREAM = (255, 251, 245)
OUT = Path(__file__).resolve().parent.parent / 'mobile' / 'public'
ASSETS = OUT.parent / 'assets'

# On a 64-unit grid, as in the SVG: the roof line, then (x, y, width, height, radius) pillars.
ROOF = [(11, 25), (32, 11), (53, 25)]
ROOF_WIDTH = 5.5
PILLARS = [(14, 30, 6.5, 22, 1.5), (24.5, 30, 6.5, 22, 1.5), (35, 30, 6.5, 22, 1.5), (45.5, 30, 6.5, 22, 1.5)]


def draw(size: int, padding: float, rounded: bool, background: bool = True) -> Image.Image:
    """`padding` is the share of each side left empty (maskable icons need room to be cropped)."""
    scale = 4  # draw big, then shrink, for smooth edges
    big = size * scale
    image = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    pen = ImageDraw.Draw(image)
    if not background:
        pass
    elif rounded:
        pen.rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 14 / 64, fill=ORANGE)
    else:
        pen.rectangle([0, 0, big, big], fill=ORANGE)
    inner = big * (1 - 2 * padding)
    unit = inner / 64
    offset = big * padding
    point = lambda x, y: (offset + x * unit, offset + y * unit)
    pen.line([point(x, y) for x, y in ROOF], fill=INK, width=round(ROOF_WIDTH * unit), joint='curve')
    for x, y in (ROOF[0], ROOF[-1]):  # round caps
        cx, cy = point(x, y)
        half = ROOF_WIDTH * unit / 2
        pen.ellipse([cx - half, cy - half, cx + half, cy + half], fill=INK)
    for x, y, w, h, r in PILLARS:
        pen.rounded_rectangle([*point(x, y), *point(x + w, y + h)], radius=r * unit, fill=CREAM)
    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    # Phone home screens add their own rounding, so these fill the square.
    draw(180, 0, False).convert('RGB').save(OUT / 'apple-touch-icon.png')
    draw(192, 0, False).convert('RGB').save(OUT / 'icon-192.png')
    draw(512, 0, False).convert('RGB').save(OUT / 'icon-512.png')
    draw(512, 0.12, False).convert('RGB').save(OUT / 'icon-maskable-512.png')
    draw(48, 0, True).save(ASSETS / 'favicon.png')
    # The installed phone app (app.json): main icon and Android's layered icon.
    draw(1024, 0, False).convert('RGB').save(ASSETS / 'icon.png')
    draw(1024, 0.2, False, background=False).save(ASSETS / 'android-icon-foreground.png')
    Image.new('RGB', (1024, 1024), ORANGE).save(ASSETS / 'android-icon-background.png')
    draw(1024, 0.2, False, background=False).save(ASSETS / 'splash-icon.png')


if __name__ == '__main__':
    main()
