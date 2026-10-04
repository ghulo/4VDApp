/**
 * Dithered drawings: a scene is a "how much ink here" value from 0 to 1 for
 * each point, printed as square blocks with ordered (Bayer) dithering, the
 * grainy halftone look of anthropic.com's illustrations. Blocks next to each
 * other in a row are merged into one run so a drawing stays a few hundred shapes.
 * The same code lives in the team app (mobile/src/components/dither.ts); a test keeps them equal.
 */

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** A horizontal run of filled blocks on one row of the grid. */
export interface Run {
  x: number;
  y: number;
  length: number;
}

/** Prints `tone(x, y)` (both 0..1, cell centres) on a `columns` × `rows` grid. */
export function dither(columns: number, rows: number, tone: (x: number, y: number) => number): Run[] {
  const runs: Run[] = [];
  for (let y = 0; y < rows; y++) {
    let start = -1;
    for (let x = 0; x <= columns; x++) {
      const threshold = (BAYER_4[y % 4]![x % 4]! + 0.5) / 16;
      const filled = x < columns && tone((x + 0.5) / columns, (y + 0.5) / rows) > threshold;
      if (filled && start < 0) start = x;
      if (!filled && start >= 0) {
        runs.push({ x: start, y, length: x - start });
        start = -1;
      }
    }
  }
  return runs;
}

// The four-pillar building on the logo's 64-unit grid (brand/README.md).
const PILLARS = [14, 24.5, 35, 45.5];

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Is this point (in logo units, 0..64) part of the building? */
export function inShop(x: number, y: number): boolean {
  if (PILLARS.some((left) => x >= left && x <= left + 6.5 && y >= 30 && y <= 52)) return true;
  if (distanceToSegment(x, y, 11, 25, 32, 11) < 2.9 || distanceToSegment(x, y, 32, 11, 53, 25) < 2.9) return true;
  return y >= 54.5 && y <= 56.5 && x >= 9 && x <= 55;
}

/**
 * The shop at sunrise, for a wide banner (aspect ≈ 2.5:1): the building in
 * solid ink at the right, a clay sun rising behind it, and the ground running
 * the width of the banner.
 */
export function shopSunrise(columns: number, rows: number) {
  const aspect = columns / rows;
  // The building sits in a square at the right of the banner, standing on the bottom edge.
  const toLogo = (x: number, y: number) => ({ lx: ((x * aspect - (aspect - 1.08)) / 1) * 64, ly: y * 64 + 6 });
  const shop = dither(columns, rows, (x, y) => {
    const { lx, ly } = toLogo(x, y);
    return inShop(lx, ly) ? 1 : 0;
  });
  const sun = dither(columns, rows, (x, y) => {
    const { lx, ly } = toLogo(x, y);
    if (inShop(lx, ly)) return 0;
    // The ground: a band along the bottom, heavier towards the shop.
    if (ly > 58.5) return 0.2 + 0.6 * x;
    // The sun: a solid disc behind the pillars, softening to paper at its edge.
    const fromSun = Math.hypot(lx - 32, ly - 33);
    return Math.max(0, Math.min(0.92, 1 - (fromSun - 15) / 17));
  });
  return { shop, sun };
}
