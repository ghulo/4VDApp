/**
 * The 4VD building (four pillars under one roof) drawn only with dots, in the
 * halftone style of Cloudflare's dotted globe: the building in full dots, a
 * faint dot field fading out around it, and a thin outline circle.
 * The geometry matches the logo's 64-unit grid.
 */

interface Dot {
  x: number;
  y: number;
  r: number;
  far: boolean;
}

const STEP = 1.6;
const CENTER = { x: 32, y: 33 };
const RADIUS = 29;
const ROOF: Array<[number, number]> = [
  [11, 25],
  [32, 11],
  [53, 25],
];
const PILLARS = [14, 24.5, 35, 45.5].map((x) => ({ x, y: 30, w: 6.5, h: 22 }));

function distanceToSegment(px: number, py: number, [ax, ay]: [number, number], [bx, by]: [number, number]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function inBuilding(x: number, y: number): boolean {
  if (PILLARS.some((p) => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h)) return true;
  if (distanceToSegment(x, y, ROOF[0]!, ROOF[1]!) < 2.9 || distanceToSegment(x, y, ROOF[1]!, ROOF[2]!) < 2.9) return true;
  return y >= 54.5 && y <= 56.5 && x >= 9 && x <= 55; // the ground step
}

function buildDots(): Dot[] {
  const dots: Dot[] = [];
  for (let y = STEP / 2; y < 64; y += STEP) {
    for (let x = STEP / 2; x < 64; x += STEP) {
      const fromCenter = Math.hypot(x - CENTER.x, y - CENTER.y);
      if (fromCenter > RADIUS) continue;
      if (inBuilding(x, y)) {
        dots.push({ x, y, r: 0.62, far: false });
      } else {
        // Smaller towards the edge, like light falling off a sphere.
        const r = 0.42 * (1 - fromCenter / RADIUS) + 0.12;
        dots.push({ x, y, r, far: true });
      }
    }
  }
  return dots;
}

const DOTS = buildDots();

export function Halftone({ className }: { className?: string }) {
  return (
    <svg
      className={['halftone-art', className].filter(Boolean).join(' ')}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="halftone-art__outline" cx={CENTER.x} cy={CENTER.y} r={RADIUS + 1.2} />
      <g fill="currentColor">
        {DOTS.map((dot) => (
          <circle
            key={`${dot.x}-${dot.y}`}
            className={dot.far ? 'halftone-art__dot--far' : undefined}
            cx={dot.x.toFixed(2)}
            cy={dot.y.toFixed(2)}
            r={dot.r.toFixed(2)}
          />
        ))}
      </g>
    </svg>
  );
}
