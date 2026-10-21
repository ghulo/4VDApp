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

/** Who is in the field. */
const CAST: Kind[] = ['cart', 'cart', 'cart', 'car', 'car', 'receipt', 'receipt', 'barcode', 'barcode'];
/** Space between a picture's dots, and each dot's radius: a little coarser than the noise, so they read in front of it. */
const GAP = 4.6;
const DOT = 1.1;
/** One sweep of the scan line from top to bottom, in seconds. */
const SCAN_PERIOD = 11;
/** Cars keep to two roads, near the top and the bottom, clear of the form. */
const LANES = [0.09, 0.91];

interface Mover {
  kind: Kind;
  x: number;
  y: number;
  /** Carts: which way they roll, and how fast that is turning. */
  heading: number;
  spin: number;
  /** Pixels a second. */
  speed: number;
  /** Carts: seconds until the next shove, and how much of the current shove is left. */
  nextPush: number;
  shove: number;
  /** Drawn width from -1 (facing left) to 1: it passes through 0, so turning round looks like turning round. */
  flip: number;
  tilt: number;
  /** Paper: where its sway is centred. Cars: which road. */
  base: number;
  phase: number;
  seed: number;
  lit: number;
  puff: number;
}
interface Bubble {
  x: number;
  y: number;
  life: number;
}

const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);
const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

/**
 * The shop moving through the sign-in page's noise, each thing the way it
 * really moves. Carts get a shove, roll and coast to a crawl, swing round in
 * wide arcs on the current and fall in with other carts. Cars cruise along two
 * roads, easing off and on the gas, bouncing a little on their springs and
 * leaving soap bubbles from the wash. Receipts and barcode labels fall like
 * dropped paper: swinging side to side, tilting into each swing, slowing at
 * its ends. A slow scan line lights up what it passes. Carts steer around the
 * form. Stands still for people who ask for less motion, and stops when the
 * page is hidden.
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
    // Paper keeps to the sides, where the form isn't.
    const sideX = () => (Math.random() < 0.5 ? 0.04 + Math.random() * 0.22 : 0.74 + Math.random() * 0.22) * width;

    const place = () => {
      let car = 0;
      movers = CAST.map((kind, i) => {
        const seed = i * 7.3 + Math.random() * 3;
        const mover: Mover = {
          kind,
          x: 0,
          y: 0,
          heading: 0,
          spin: 0,
          speed: 0,
          nextPush: Math.random() * 2,
          shove: 0,
          flip: 1,
          tilt: 0,
          base: 0,
          phase: Math.random() * 10,
          seed,
          lit: 0,
          puff: 0,
        };
        if (kind === 'cart') {
          const angle = (i / 3) * Math.PI * 2 + 0.6;
          mover.x = width / 2 + Math.cos(angle) * width * 0.38;
          mover.y = height / 2 + Math.sin(angle) * height * 0.4;
          mover.heading = angle + Math.PI / 2;
          mover.speed = 12;
          mover.flip = Math.cos(mover.heading) >= 0 ? 1 : -1;
        } else if (kind === 'car') {
          mover.base = car;
          mover.flip = car === 0 ? 1 : -1;
          mover.x = Math.random() * width;
          mover.y = LANES[car]! * height;
          mover.speed = 34;
          car += 1;
        } else {
          mover.base = sideX();
          mover.x = mover.base;
          mover.y = Math.random() * height;
        }
        return mover;
      });
    };

    const moveCart = (mover: Mover, dt: number, time: number) => {
      // The current: which way the noise flows here.
      const flow = noise(mover.x * 0.0022, mover.y * 0.0022, time * 0.03) * Math.PI * 2;
      let dx = Math.cos(flow);
      let dy = Math.sin(flow);
      // Steer around the form in the middle.
      const ox = (mover.x - width / 2) / (width * 0.34);
      const oy = (mover.y - height / 2) / (height * 0.4);
      const inside = ox * ox + oy * oy;
      if (inside < 1.4) {
        dx += ox * (1.4 - inside) * 3;
        dy += oy * (1.4 - inside) * 3;
      }
      for (const other of movers) {
        if (other === mover || other.kind !== 'cart') continue;
        const sx = mover.x - other.x;
        const sy = mover.y - other.y;
        const distance = Math.hypot(sx, sy) || 1;
        // Give each other room, but fall in with company.
        if (distance < 80) {
          dx += (sx / distance) * ((80 - distance) / 40);
          dy += (sy / distance) * ((80 - distance) / 40);
        } else if (distance < 220) {
          dx += Math.cos(other.heading) * 0.5;
          dy += Math.sin(other.heading) * 0.5;
        }
      }
      // Turn like something with weight: the turn builds and settles, so the path is an arc.
      const want = wrapAngle(Math.atan2(dy, dx) - mover.heading);
      mover.spin += (want * 1.4 - mover.spin * 2) * dt;
      mover.heading = wrapAngle(mover.heading + mover.spin * dt);
      // A shove, then rolling and slowing down: nobody pushes a cart at one speed.
      mover.nextPush -= dt;
      if (mover.nextPush <= 0) {
        mover.shove = 0.4 + Math.random() * 0.3;
        mover.nextPush = 2.2 + Math.random() * 2.8;
      }
      if (mover.shove > 0) {
        mover.speed += 55 * dt;
        mover.shove -= dt;
      }
      mover.speed = Math.max(4, mover.speed * Math.exp(-dt * 0.55));
      mover.x += Math.cos(mover.heading) * mover.speed * dt;
      mover.y += Math.sin(mover.heading) * mover.speed * dt;
      // Face the way it rolls, turning round only once it clearly heads the other way.
      const across = Math.cos(mover.heading);
      const facing = across > 0.2 ? 1 : across < -0.2 ? -1 : Math.sign(mover.flip) || 1;
      mover.flip += (facing - mover.flip) * ease(dt, 3);
      // Nose up going uphill, and a little wheel wobble when it's quick.
      const slope = clamp(wrapAngle(facing === 1 ? mover.heading : mover.heading - Math.PI), 0.32);
      const wobble = Math.sin(mover.phase * 19) * 0.025 * Math.min(1, mover.speed / 25);
      mover.tilt += (slope - mover.tilt) * ease(dt, 4);
      mover.tilt += wobble * ease(dt, 10);
    };

    const moveCar = (mover: Mover, dt: number, time: number) => {
      // Cruising, easing off the gas and back on now and then.
      const cruise = 30 + (noise(time * 0.12, mover.seed, 0.5) + 1) * 14;
      const accel = (cruise - mover.speed) * 0.7;
      mover.speed += accel * dt;
      mover.x += mover.flip * mover.speed * dt;
      // Drifts a little within its lane, never sharply.
      const lane = LANES[mover.base]! * height;
      mover.y = lane + noise(time * 0.08, mover.seed, 1.5) * 16;
      // The nose dips when it slows and lifts when it speeds up.
      mover.tilt += (clamp(-accel * 0.012 * mover.flip, 0.05) - mover.tilt) * ease(dt, 3);
      // Soap from the wash, puffing out behind.
      mover.puff += dt;
      if (mover.puff > 0.18) {
        mover.puff = 0;
        const back = (SPRITES.car[0].length * GAP) / 2;
        bubbles.push({ x: mover.x - mover.flip * back, y: mover.y + 6 + (Math.random() - 0.5) * 8, life: 1 });
      }
    };

    const movePaper = (mover: Mover, dt: number, time: number) => {
      // Falling like dropped paper: a swing side to side, tilting into it, slowest at the ends.
      const swing = mover.phase * 0.85 + mover.seed;
      const flow = noise(mover.base * 0.003, mover.y * 0.003, time * 0.03);
      mover.base += flow * 6 * dt;
      mover.x = mover.base + Math.sin(swing) * 24;
      mover.y += (5 + 11 * Math.abs(Math.cos(swing))) * dt;
      mover.tilt = Math.cos(swing) * 0.38;
      // It turns over slowly as it falls.
      mover.flip = 0.65 + 0.35 * Math.cos(mover.phase * 0.5 + mover.seed);
      if (mover.y > height + 60) {
        mover.y = -60;
        mover.base = sideX();
      }
    };

    const step = (dt: number, time: number, scanY: number) => {
      for (const mover of movers) {
        mover.phase += dt;
        if (mover.kind === 'cart') moveCart(mover, dt, time);
        else if (mover.kind === 'car') moveCar(mover, dt, time);
        else movePaper(mover, dt, time);
        // Out one side, back in the other.
        const margin = 60;
        if (mover.x < -margin) {
          mover.x = width + margin;
          mover.base = mover.kind === 'car' ? mover.base : mover.x;
        }
        if (mover.x > width + margin) {
          mover.x = -margin;
          mover.base = mover.kind === 'car' ? mover.base : mover.x;
        }
        if (mover.kind === 'cart' && mover.y < -margin) mover.y = height + margin;
        if (mover.kind === 'cart' && mover.y > height + margin) mover.y = -margin;
        mover.lit = Math.abs(mover.y - scanY) < 16 ? 1 : Math.max(0, mover.lit - dt * 1.2);
      }
      for (const bubble of bubbles) {
        bubble.life -= dt / 2.4;
        bubble.y -= dt * 10;
        bubble.x += Math.sin(bubble.life * 8 + bubble.y * 0.05) * dt * 5;
      }
      while (bubbles.length > 0 && bubbles[0]!.life <= 0) bubbles.shift();
    };

    const drawSprite = (mover: Mover) => {
      const rows = SPRITES[mover.kind];
      const columns = rows[0]!.length;
      // A car rides on its springs.
      const bounce = mover.kind === 'car' ? Math.sin(mover.phase * 9 + mover.seed) * 0.5 : 0;
      context.save();
      context.translate(mover.x, mover.y + bounce);
      context.rotate(mover.tilt);
      context.scale(mover.flip, 1);
      context.globalAlpha = 0.8 + mover.lit * 0.2;
      context.beginPath();
      rows.forEach((row, r) => {
        for (let c = 0; c < columns; c++) {
          if (row[c] !== '#') continue;
          const x = (c - (columns - 1) / 2) * GAP;
          const y = (r - (rows.length - 1) / 2) * GAP;
          context.moveTo(x + DOT, y);
          context.arc(x, y, DOT, 0, Math.PI * 2);
        }
      });
      context.fill();
      context.restore();
    };

    const draw = (scanY: number) => {
      context.clearRect(0, 0, width, height);
      // The scan line: a faint row of dots.
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
      else if (frame === 0) {
        last = 0;
        frame = requestAnimationFrame(tick);
      }
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
