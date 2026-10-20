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

/** Space between dots, in CSS pixels. */
const GAP = 14;
/** How big the noise's features are: smaller is broader. */
const SCALE = 0.0065;

/**
 * Decoration for the sign-in page's form side: a field of amber dots, each
 * sized by Perlin noise that drifts slowly, like a halftone print of moving
 * weather. Still for people who ask for less motion, idle while hidden.
 */
export function NoiseField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return undefined;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);
      context.fillStyle = getComputedStyle(canvas).color;
      // Two octaves: broad swells with finer grain riding on them.
      for (let y = GAP / 2; y < height; y += GAP) {
        for (let x = GAP / 2; x < width; x += GAP) {
          const n = noise(x * SCALE, y * SCALE, time) * 0.75 + noise(x * SCALE * 2.3, y * SCALE * 2.3, time * 1.6) * 0.25;
          const radius = Math.max(0, (n + 0.15) * 0.9) * (GAP / 2);
          if (radius < 0.35) continue;
          context.beginPath();
          context.arc(x, y, Math.min(radius, GAP / 2 - 1), 0, Math.PI * 2);
          context.fill();
        }
      }
    };

    resize();
    draw(0);
    const observer = new ResizeObserver(() => {
      resize();
      if (still) draw(0);
    });
    observer.observe(canvas);
    if (still) return () => observer.disconnect();

    let id = 0;
    let last = 0;
    const loop = (now: number) => {
      id = requestAnimationFrame(loop);
      // 30 frames a second is plenty for a slow drift; skip work while hidden by the layout.
      if (now - last < 33 || canvas.offsetParent === null) return;
      last = now;
      draw(now / 9000);
    };
    id = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(id);
      observer.disconnect();
    };
  }, []);
  return <canvas ref={ref} className="noise-field" aria-hidden="true" />;
}
