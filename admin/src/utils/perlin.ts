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
export function noise(x: number, y: number, z: number): number {
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
export function fbm(x: number, y: number, z: number, octaves: number): number {
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

/** A steady pseudo-random number in 0..1 for a grid point, the same on every visit. */
export function hash(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
