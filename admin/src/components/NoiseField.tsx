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

/** A steady pseudo-random number in 0..1 for a grid point, so the grain never changes between visits. */
function hash(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/** Space between dots, in CSS pixels, and each dot's radius. */
const GAP = 4;
const DOT = 0.65;
/** How big the noise's features are: smaller is broader. */
const SCALE = 0.0036;
/** How far the noise bends itself: higher swirls more. */
const WARP = 1.6;
/** Contour lines per unit of noise, and how thick each line is (0 to 1). */
const LEVELS = 8;
const LINE = 0.2;

/**
 * Decoration for the sign-in page's form side: Perlin noise bent through
 * itself (domain warping), drawn as a topographic map in fine amber dots.
 * Dots trace the contour lines (every fourth one stronger, like an index
 * contour), a fine grain fills the high ground between them, and the peaks
 * glow. Still: drawn once, and again when the panel changes size.
 */
export function NoiseField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return undefined;

    const dot = (x: number, y: number, radius: number, alpha: number) => {
      context.globalAlpha = alpha;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    };

    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = getComputedStyle(canvas).color;
      for (let y = GAP / 2; y < height; y += GAP) {
        for (let x = GAP / 2; x < width; x += GAP) {
          const [px, py] = [x * SCALE, y * SCALE];
          // Bend the field through itself: swirls and marbling instead of round hills.
          // The bend itself is smooth (two octaves), so the lines stay whole.
          const qx = fbm(px + 1.7, py + 9.2, 0.3, 2);
          const qy = fbm(px + 8.3, py + 2.8, 1.1, 2);
          const n = fbm(px + WARP * qx, py + WARP * qy, 2.4, 2);
          const level = (n + 1.6) * LEVELS;
          const along = level - Math.floor(level);
          const height01 = Math.min(1, Math.max(0, (n + 0.9) / 1.8));
          if (along < LINE) {
            const index = Math.floor(level) % 4 === 0;
            dot(x, y, index ? DOT * 1.4 : DOT, index ? 1 : 0.6);
          } else if (hash(x, y) < height01 * height01 * 0.22) {
            // Grain between the lines, thicker on the high ground.
            dot(x, y, DOT * 0.7, 0.18 + height01 * 0.25);
          }
          // The peaks glow: a few larger, brighter dots on the highest ground.
          if (height01 > 0.88 && hash(y, x) < 0.3) dot(x, y, DOT * 1.6, 0.9);
        }
      }
      context.globalAlpha = 1;
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  return <canvas ref={ref} className="noise-field" aria-hidden="true" />;
}
