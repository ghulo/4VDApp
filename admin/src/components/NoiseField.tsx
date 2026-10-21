import { useEffect, useRef } from 'react';

/** Ken Perlin's improved noise: one shuffled table, doubled so lookups never wrap. */
const PERM = (() => {
  const table = Array.from({ length: 256 }, (_, i) => i);
  // A fixed shuffle (no Math.random), so the field looks the same on every visit.
  let seed = 4;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    [table[i], table[j]] = [table[j]!, table[i]!];
  }
  return [...table, ...table];
})();

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (t: number, a: number, b: number) => a + t * (b - a);
function grad(hash: number, x: number, y: number, z: number) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/** Smooth noise in about -1..1 for a point in space. */
function noise(x: number, y: number, z: number): number {
  const [X, Y, Z] = [Math.floor(x) & 255, Math.floor(y) & 255, Math.floor(z) & 255];
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const [u, v, w] = [fade(x), fade(y), fade(z)];
  const p = PERM;
  const A = p[X]! + Y;
  const AA = p[A]! + Z;
  const AB = p[A + 1]! + Z;
  const B = p[X + 1]! + Y;
  const BA = p[B]! + Z;
  const BB = p[B + 1]! + Z;
  return lerp(
    w,
    lerp(v, lerp(u, grad(p[AA]!, x, y, z), grad(p[BA]!, x - 1, y, z)), lerp(u, grad(p[AB]!, x, y - 1, z), grad(p[BB]!, x - 1, y - 1, z))),
    lerp(v, lerp(u, grad(p[AA + 1]!, x, y, z - 1), grad(p[BA + 1]!, x - 1, y, z - 1)), lerp(u, grad(p[AB + 1]!, x, y - 1, z - 1), grad(p[BB + 1]!, x - 1, y - 1, z - 1))),
  );
}

/** Octaves of noise added up: broad shapes with finer detail on them. */
function fbm(x: number, y: number, z: number, octaves: number): number {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave++) {
    total += noise(x * frequency, y * frequency, z) * amplitude;
    amplitude *= 0.45;
    frequency *= 2;
  }
  return total;
}

/** The 8×8 Bayer matrix: thresholds spread so any shade becomes an even pattern of pixels. */
const BAYER = (() => {
  const size = 8;
  const matrix: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Interleave the bits of x and x^y, reversed: the classic recursive Bayer order.
      let value = 0;
      const xy = x ^ y;
      for (let bit = 2; bit >= 0; bit--) {
        value = (value << 2) | (((xy >> (2 - bit)) & 1) << 1) | ((x >> (2 - bit)) & 1);
      }
      matrix.push((value + 0.5) / (size * size));
    }
  }
  return matrix;
})();

/** Size of one dither pixel, in CSS pixels, and how much of the cell it fills. */
const CELL = 3;
const PIXEL = 2;
/** How big the noise's features are: smaller is broader. */
const SCALE = 0.0034;
/** How far the noise bends itself: higher swirls more. */
const WARP = 1.8;
/** Shade curve: above 1 leaves more dark ground and sharper bright ridges. */
const CONTRAST = 1.3;

/**
 * Decoration for the sign-in page's form side: Perlin noise bent through
 * itself (domain warping), shaded and then ordered-dithered with a Bayer
 * matrix, like an old one-bit screen: amber pixels, dense where the field is
 * bright and thinning to a fine cross-hatch where it fades. Still: drawn
 * once, and again when the panel changes size.
 */
export function NoiseField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return undefined;

    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = getComputedStyle(canvas).color;
      const inset = (CELL - PIXEL) / 2;
      for (let row = 0; row * CELL < height; row++) {
        for (let column = 0; column * CELL < width; column++) {
          const [px, py] = [column * CELL * SCALE, row * CELL * SCALE];
          // Bend the field through itself: swirls and marbling instead of round hills.
          const qx = fbm(px + 1.7, py + 9.2, 0.3, 2);
          const qy = fbm(px + 8.3, py + 2.8, 1.1, 2);
          const n = fbm(px + WARP * qx, py + WARP * qy, 2.4, 3);
          const shade = Math.min(1, Math.max(0, (n + 0.55) / 1.1)) ** CONTRAST;
          if (shade > BAYER[(row % 8) * 8 + (column % 8)]!) {
            context.fillRect(column * CELL + inset, row * CELL + inset, PIXEL, PIXEL);
          }
        }
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  return <canvas ref={ref} className="noise-field" aria-hidden="true" />;
}
