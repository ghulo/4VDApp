import { useEffect, useRef } from 'react';
import { noise } from '../utils/perlin';

/** Little pictures drawn in dots: '#' is a dot, anything else is empty. All face right. */
const SPRITES = {
  cart: [
    '#...............',
    '##..............',
    '.##############.',
    '..#.#.#.#.#.#.#.',
    '..############..',
    '...#.#.#.#.#.#..',
    '...##########...',
    '.............#..',
    '...###########..',
    '....##.....##...',
    '....##.....##...',
  ],
  car: [
    '.....#######........',
    '....#...#....#......',
    '...#....#.....#.....',
    '.##################.',
    '####################',
    '####################',
    '.###..........###...',
    '..#............#....',
  ],
  receipt: [
    '#########',
    '#.......#',
    '#.#####.#',
    '#.......#',
    '#.###.#.#',
    '#.......#',
    '#.####..#',
    '#.......#',
    '#.....###',
    '#.......#',
    '#.#.#.#.#',
    '.#.#.#.#.',
  ],
  barcode: [
    '#.##.#.###.#.##',
    '#.##.#.###.#.##',
    '#.##.#.###.#.##',
    '#.##.#.###.#.##',
    '#.##.#.###.#.##',
    '#.##.#.###.#.##',
    '...............',
    '#.#.#.#.#.#.#.#',
  ],
} as const;
type Kind = keyof typeof SPRITES;

/** Who swims in the field, and how fast each kind goes (CSS pixels a second). */
const CAST: Kind[] = ['cart', 'cart', 'cart', 'car', 'car', 'receipt', 'receipt', 'barcode', 'barcode'];
const SPEED: Record<Kind, number> = { cart: 20, car: 30, receipt: 8, barcode: 8 };
/** Space between a picture's dots, and each dot's radius: a little coarser than the noise, so they read in front of it. */
const GAP = 4.6;
const DOT = 1.1;
/** One sweep of the scan line from top to bottom, in seconds. */
const SCAN_PERIOD = 11;

interface Mover {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  phase: number;
  lit: number;
  puff: number;
}
interface Bubble {
  x: number;
  y: number;
  life: number;
}

/**
 * The shop, swimming through the sign-in page's noise like fish in a current:
 * carts cruise and now and then fall in behind each other, cars roll across
 * leaving soap bubbles from the wash, receipts and barcodes drift and bob,
 * and a slow scan line passes over everything, lighting up what it touches.
 * Everyone steers around the form in the middle. Stands still for people who
 * ask for less motion, and stops when the page is hidden.
 */
export function ShopDrift() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return undefined;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let movers: Mover[] = [];
    const bubbles: Bubble[] = [];

    // Start everyone around the edge, clear of the form.
    const place = () => {
      movers = CAST.map((kind, i) => {
        const angle = (i / CAST.length) * Math.PI * 2 + 0.4;
        const facing = Math.cos(angle) > 0 ? 1 : -1;
        return {
          kind,
          x: width / 2 + Math.cos(angle) * width * 0.4,
          y: height / 2 + Math.sin(angle) * height * 0.42,
          vx: facing * SPEED[kind],
          vy: 0,
          facing,
          phase: i * 1.7,
          lit: 0,
          puff: 0,
        };
      });
    };

    const step = (dt: number, time: number, scanY: number) => {
      for (const mover of movers) {
        // The current: which way the noise flows here.
        const flow = noise(mover.x * 0.0022, mover.y * 0.0022, time * 0.03) * Math.PI * 2;
        let dx = Math.cos(flow);
        let dy = Math.sin(flow);
        // Cars keep to the road: they roll the way they face and only drift a little.
        if (mover.kind === 'car') [dx, dy] = [mover.facing * 1.5, dy * 0.3];
        // Steer around the form in the middle.
        const ox = (mover.x - width / 2) / (width * 0.34);
        const oy = (mover.y - height / 2) / (height * 0.4);
        const inside = ox * ox + oy * oy;
        if (inside < 1.3) {
          dx += ox * (1.3 - inside) * 3;
          dy += oy * (1.3 - inside) * 3;
        }
        for (const other of movers) {
          if (other === mover) continue;
          const sx = mover.x - other.x;
          const sy = mover.y - other.y;
          const distance = Math.hypot(sx, sy) || 1;
          // Give each other room…
          if (distance < 70) {
            dx += (sx / distance) * ((70 - distance) / 35);
            dy += (sy / distance) * ((70 - distance) / 35);
          }
          // …but carts like company: near another cart they fall in alongside it.
          if (mover.kind === 'cart' && other.kind === 'cart' && distance < 180) {
            dx += (other.vx / SPEED.cart) * 0.6;
            dy += (other.vy / SPEED.cart) * 0.6;
          }
        }
        const length = Math.hypot(dx, dy) || 1;
        const ease = 1 - Math.exp(-dt * 0.9);
        mover.vx += ((dx / length) * SPEED[mover.kind] - mover.vx) * ease;
        mover.vy += ((dy / length) * SPEED[mover.kind] - mover.vy) * ease;
        mover.x += mover.vx * dt;
        mover.y += mover.vy * dt;
        // Out one side, back in the other.
        const margin = 50;
        if (mover.x < -margin) mover.x = width + margin;
        if (mover.x > width + margin) mover.x = -margin;
        if (mover.y < -margin) mover.y = height + margin;
        if (mover.y > height + margin) mover.y = -margin;
        // Turn the picture round only once it is clearly heading the other way.
        if (mover.vx > 6) mover.facing = 1;
        if (mover.vx < -6) mover.facing = -1;
        mover.phase += dt;
        mover.lit = Math.abs(mover.y - scanY) < 16 ? 1 : Math.max(0, mover.lit - dt * 1.2);
        // Soap from the wash, puffing out behind each car.
        if (mover.kind === 'car') {
          mover.puff += dt;
          if (mover.puff > 0.22) {
            mover.puff = 0;
            const back = (SPRITES.car[0].length * GAP) / 2;
            bubbles.push({ x: mover.x - mover.facing * back, y: mover.y + (Math.random() - 0.3) * 10, life: 1 });
          }
        }
      }
      for (const bubble of bubbles) {
        bubble.life -= dt / 2.2;
        bubble.y -= dt * 9;
        bubble.x += Math.sin(bubble.life * 9) * dt * 4;
      }
      while (bubbles.length > 0 && bubbles[0]!.life <= 0) bubbles.shift();
    };

    const drawSprite = (mover: Mover) => {
      const rows = SPRITES[mover.kind];
      const columns = rows[0]!.length;
      const bob = mover.kind === 'receipt' || mover.kind === 'barcode' ? Math.sin(mover.phase * 1.3) * 3 : 0;
      const left = mover.x - (columns * GAP) / 2;
      const top = mover.y + bob - (rows.length * GAP) / 2;
      context.globalAlpha = 0.8 + mover.lit * 0.2;
      context.beginPath();
      rows.forEach((row, r) => {
        for (let c = 0; c < columns; c++) {
          const column = mover.facing === 1 ? c : columns - 1 - c;
          if (row[column] !== '#') continue;
          const [x, y] = [left + c * GAP, top + r * GAP];
          context.moveTo(x + DOT, y);
          context.arc(x, y, DOT, 0, Math.PI * 2);
        }
      });
      context.fill();
    };

    const draw = (scanY: number) => {
      context.clearRect(0, 0, width, height);
      // The scan line: a faint row of dots with a brighter core.
      context.globalAlpha = 0.3;
      context.beginPath();
      for (let x = GAP / 2; x < width; x += GAP * 2) {
        context.moveTo(x + DOT, scanY);
        context.arc(x, scanY, DOT, 0, Math.PI * 2);
      }
      context.fill();
      for (const mover of movers) drawSprite(mover);
      context.lineWidth = 0.8;
      for (const bubble of bubbles) {
        context.globalAlpha = bubble.life * 0.7;
        context.beginPath();
        context.arc(bubble.x, bubble.y, 1 + (1 - bubble.life) * 2.5, 0, Math.PI * 2);
        context.stroke();
      }
      context.globalAlpha = 1;
    };

    let frame = 0;
    let last = 0;
    let time = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      time += dt;
      const scanY = ((time / SCAN_PERIOD) % 1) * (height + 60) - 30;
      step(dt, time, scanY);
      draw(scanY);
      frame = requestAnimationFrame(tick);
    };

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const first = width === 0;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const colour = getComputedStyle(canvas).color;
      context.fillStyle = colour;
      context.strokeStyle = colour;
      if (width === 0) {
        // Hidden (phones): nothing to animate.
        cancelAnimationFrame(frame);
        frame = 0;
        return;
      }
      if (first || movers.length === 0) place();
      if (still) draw(-100);
      else if (frame === 0) frame = requestAnimationFrame(tick);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return <canvas ref={ref} className="shop-drift" aria-hidden="true" />;
}
