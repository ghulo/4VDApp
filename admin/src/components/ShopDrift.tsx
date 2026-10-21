import { useEffect, useRef } from 'react';
import { fbm, hash, noise } from '../utils/perlin';
import { drawBarcode, drawCar, drawCart, drawReceipt, type Shade } from './shopDriftArt';

/** One dot every GAP CSS pixels: the noise and everything in it share this grid. */
const GAP = 4;
/** How big the pictures are drawn: big enough that each reads in dots. */
const SIZE = 1.45;
/** Brightness steps a dot can take; each is drawn once and stamped. */
const LEVELS = 24;
/** The noise map: feature size, how far it bends itself, contour lines per unit, line thickness. */
const SCALE = 0.0036;
const WARP = 1.6;
const CONTOURS = 8;
const LINE = 0.2;
/** One sweep of the scan beam from top to bottom, in seconds. */
const SCAN_PERIOD = 11;
/** Cars keep to roads near the top and the bottom, clear of the form; the third is further back. */
const LANES = [0.1, 0.93, 0.85];

type Kind = 'cart' | 'car' | 'receipt' | 'barcode';
/** Who is in the field, and how near (1) or far back (smaller, dimmer, slower) each is. */
const CAST: { kind: Kind; depth: number }[] = [
  { kind: 'cart', depth: 1 },
  { kind: 'cart', depth: 1 },
  { kind: 'cart', depth: 0.62 },
  { kind: 'car', depth: 1 },
  { kind: 'car', depth: 1 },
  { kind: 'car', depth: 0.6 },
  { kind: 'receipt', depth: 1 },
  { kind: 'receipt', depth: 0.7 },
  { kind: 'receipt', depth: 0.6 },
  { kind: 'barcode', depth: 1 },
  { kind: 'barcode', depth: 0.65 },
];

interface Mover {
  kind: Kind;
  depth: number;
  x: number;
  y: number;
  heading: number;
  spin: number;
  speed: number;
  nextPush: number;
  shove: number;
  flip: number;
  tilt: number;
  /** Paper: where its sway is centred. Cars: which road. */
  base: number;
  phase: number;
  seed: number;
  wheel: number;
  /** Cart: the shopping in it. Receipt: its printed lines. Barcode: its bars. */
  detail: number[];
  foam: number;
  flash: number;
  scanned: boolean;
  puff: number;
}
interface Ripple {
  x: number;
  y: number;
  age: number;
  strength: number;
}
interface Bubble {
  x: number;
  y: number;
  life: number;
  size: number;
}

const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);
const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

/** Bars and gaps of one or two dots' width that fit across a label. */
function makeBars(): number[] {
  const bars: number[] = [];
  let used = 0;
  while (used < 48) {
    const width = Math.random() < 0.6 ? 4 : 8;
    if (used + width > 52) break;
    bars.push(width);
    used += width;
  }
  return bars;
}

/**
 * The sign-in page's form side: a topographic map of Perlin noise in fine
 * amber dots, with the shop moving through it the way sharks move through
 * water. Everything is drawn on one grid of dots: the carts, cars, receipts
 * and barcode labels are shaded shapes turned into dots (bigger and brighter
 * where they are lit), they hide the map where they pass, and the map
 * brightens in their wake. Carts get a shove, roll and coast, and drift
 * curiously towards the pointer; cars cruise their roads with headlights and
 * soap from the wash; paper falls swinging and is blown aside by the pointer.
 * A scan beam sweeps down and beeps the barcodes it reads, sending out a ripple.
 * Stands still for people who ask for less motion; stops when the page is hidden.
 */
export function ShopDrift() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    const scene = document.createElement('canvas');
    const paint = scene.getContext('2d', { willReadFrequently: true });
    if (!canvas || !context || !paint) return undefined;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let columns = 0;
    let rows = 0;
    let ratio = 1;
    /** The frame is written straight into pixels: one buffer, one put a frame. */
    let frameImage = context.createImageData(1, 1);
    let framePixels = new Uint32Array(0);
    /** For each brightness step, the pixels of its dot: where (from the dot's corner) and what colour. */
    let stampOffsets: Int32Array[] = [];
    let stampColours: Uint32Array[] = [];
    /** The noise map's brightness per dot, a twinkle phase per dot, and the fading wakes. */
    let field = new Float32Array(0);
    let twinkle = new Float32Array(0);
    let wake = new Float32Array(0);
    let movers: Mover[] = [];
    const ripples: Ripple[] = [];
    const bubbles: Bubble[] = [];
    const pointer = { x: 0, y: 0, on: false, glow: 0 };
    let dim = 1;
    const shade: Shade = (light, cover = 1) => `rgba(${Math.round(light * dim * 255)},0,0,${cover})`;

    // The topographic map, worked out once per size.
    const mapField = () => {
      field = new Float32Array(columns * rows);
      twinkle = new Float32Array(columns * rows);
      wake = new Float32Array(columns * rows);
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const [x, y] = [GAP / 2 + column * GAP, GAP / 2 + row * GAP];
          const [px, py] = [x * SCALE, y * SCALE];
          const qx = fbm(px + 1.7, py + 9.2, 0.3, 2);
          const qy = fbm(px + 8.3, py + 2.8, 1.1, 2);
          const n = fbm(px + WARP * qx, py + WARP * qy, 2.4, 2);
          const level = (n + 1.6) * CONTOURS;
          const high = Math.min(1, Math.max(0, (n + 0.9) / 1.8));
          let light = 0;
          if (level - Math.floor(level) < LINE) light = Math.floor(level) % 4 === 0 ? 0.48 : 0.28;
          else if (hash(x, y) < high * high * 0.22) light = 0.07 + high * 0.08;
          if (high > 0.88 && hash(y, x) < 0.3) light = Math.max(light, 0.44);
          const index = row * columns + column;
          field[index] = light;
          twinkle[index] = hash(x * 0.37, y * 0.71) * Math.PI * 2;
        }
      }
    };

    // Every dot size drawn once, then copied pixel by pixel: far quicker than drawing circles.
    const makeStamps = () => {
      const size = Math.ceil(GAP * ratio);
      const sheet = document.createElement('canvas');
      sheet.width = size * LEVELS;
      sheet.height = size;
      const ink = sheet.getContext('2d');
      if (!ink) return;
      ink.fillStyle = getComputedStyle(canvas).color;
      for (let level = 1; level < LEVELS; level++) {
        const light = level / (LEVELS - 1);
        ink.globalAlpha = 0.12 + 0.88 * light;
        ink.beginPath();
        ink.arc(level * size + size / 2, size / 2, (0.3 + 1.15 * light) * ratio, 0, Math.PI * 2);
        ink.fill();
      }
      const sheetPixels = new Uint32Array(ink.getImageData(0, 0, sheet.width, size).data.buffer);
      stampOffsets = [];
      stampColours = [];
      for (let level = 0; level < LEVELS; level++) {
        const offsets: number[] = [];
        const colours: number[] = [];
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const colour = sheetPixels[y * sheet.width + level * size + x]!;
            if (colour >>> 24 === 0) continue;
            offsets.push(y * frameImage.width + x);
            colours.push(colour);
          }
        }
        stampOffsets.push(Int32Array.from(offsets));
        stampColours.push(Uint32Array.from(colours));
      }
    };

    const sideX = () => (Math.random() < 0.5 ? 0.04 + Math.random() * 0.2 : 0.76 + Math.random() * 0.2) * width;
    const place = () => {
      let lane = 0;
      movers = CAST.map(({ kind, depth }, i) => {
        const mover: Mover = {
          kind,
          depth,
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
          seed: i * 7.3 + Math.random() * 3,
          wheel: 0,
          detail: [],
          foam: 1,
          flash: 0,
          scanned: false,
          puff: 0,
        };
        if (kind === 'cart') {
          const angle = (i / 3) * Math.PI * 2 + 0.6;
          mover.x = width / 2 + Math.cos(angle) * width * 0.38;
          mover.y = height / 2 + Math.sin(angle) * height * 0.4;
          mover.heading = angle + Math.PI / 2;
          mover.speed = 12;
          mover.flip = Math.cos(mover.heading) >= 0 ? 1 : -1;
          mover.detail = Array.from({ length: 5 }, () => (Math.random() < 0.3 ? 0 : 4 + Math.random() * 14));
        } else if (kind === 'car') {
          mover.base = lane;
          mover.flip = lane === 1 ? -1 : 1;
          mover.x = Math.random() * width;
          mover.y = LANES[lane]! * height;
          mover.speed = 34;
          mover.foam = Math.random();
          lane += 1;
        } else {
          mover.base = sideX();
          mover.x = mover.base;
          mover.y = Math.random() * height;
          mover.detail = kind === 'receipt' ? Array.from({ length: 6 }, () => 6 + Math.random() * 10) : makeBars();
        }
        return mover;
      });
    };

    const moveCart = (mover: Mover, dt: number, time: number) => {
      const flow = noise(mover.x * 0.0022, mover.y * 0.0022, time * 0.03) * Math.PI * 2;
      let dx = Math.cos(flow);
      let dy = Math.sin(flow);
      // Steer around the form in the middle.
      const ox = (mover.x - width / 2) / (width * 0.34);
      const oy = (mover.y - 45 - height / 2) / (height * 0.4);
      const inside = ox * ox + oy * oy;
      if (inside < 1.4) {
        dx += ox * (1.4 - inside) * 3;
        dy += oy * (1.4 - inside) * 3;
      }
      // Curious about the pointer: drift towards it, but not right onto it.
      if (pointer.on && mover.depth === 1) {
        const px = pointer.x - mover.x;
        const py = pointer.y - (mover.y - 45);
        const distance = Math.hypot(px, py) || 1;
        if (distance < 280 && distance > 70) {
          dx += (px / distance) * 0.9;
          dy += (py / distance) * 0.9;
        }
      }
      for (const other of movers) {
        if (other === mover || other.kind !== 'cart' || other.depth !== mover.depth) continue;
        const sx = mover.x - other.x;
        const sy = mover.y - other.y;
        const distance = Math.hypot(sx, sy) || 1;
        if (distance < 100) {
          dx += (sx / distance) * ((100 - distance) / 45);
          dy += (sy / distance) * ((100 - distance) / 45);
        } else if (distance < 240) {
          dx += Math.cos(other.heading) * 0.5;
          dy += Math.sin(other.heading) * 0.5;
        }
      }
      // Turning has weight: it builds and settles, so the path is an arc.
      const want = wrapAngle(Math.atan2(dy, dx) - mover.heading);
      mover.spin += (want * 1.4 - mover.spin * 2) * dt;
      mover.heading = wrapAngle(mover.heading + mover.spin * dt);
      // A shove, then rolling and slowing: nobody pushes a cart at one speed.
      mover.nextPush -= dt;
      if (mover.nextPush <= 0) {
        mover.shove = 0.4 + Math.random() * 0.3;
        mover.nextPush = 2.2 + Math.random() * 2.8;
        if (mover.depth === 1) ripples.push({ x: mover.x, y: mover.y - 4, age: 0, strength: 0.35 });
      }
      if (mover.shove > 0) {
        mover.speed += 55 * dt;
        mover.shove -= dt;
      }
      mover.speed = Math.max(4, mover.speed * Math.exp(-dt * 0.55));
      const speed = mover.speed * mover.depth;
      mover.x += Math.cos(mover.heading) * speed * dt;
      mover.y += Math.sin(mover.heading) * speed * dt;
      mover.wheel += (speed * dt) / 5.5;
      const across = Math.cos(mover.heading);
      const facing = across > 0.2 ? 1 : across < -0.2 ? -1 : Math.sign(mover.flip) || 1;
      mover.flip += (facing - mover.flip) * ease(dt, 3);
      const slope = clamp(wrapAngle(facing === 1 ? mover.heading : mover.heading - Math.PI), 0.3);
      mover.tilt += (slope - mover.tilt) * ease(dt, 4);
    };

    const moveCar = (mover: Mover, dt: number, time: number) => {
      const cruise = 30 + (noise(time * 0.12, mover.seed, 0.5) + 1) * 14;
      const accel = (cruise - mover.speed) * 0.7;
      mover.speed += accel * dt;
      const speed = mover.speed * mover.depth;
      mover.x += mover.flip * speed * dt;
      mover.y = LANES[mover.base]! * height + noise(time * 0.08, mover.seed, 1.5) * 14;
      mover.wheel += (speed * dt) / 10;
      mover.tilt += (clamp(-accel * 0.012 * mover.flip, 0.05) - mover.tilt) * ease(dt, 3);
      // The foam dries off as it drives; bubbles blow off it and from behind.
      mover.foam = Math.max(0, mover.foam - dt * 0.035);
      mover.puff += dt;
      if (mover.puff > 0.16) {
        mover.puff = 0;
        const back = 60 * mover.depth * SIZE;
        bubbles.push({
          x: mover.x - mover.flip * back,
          y: mover.y - 26 * mover.depth + (Math.random() - 0.5) * 18,
          life: 1,
          size: (3 + Math.random() * 5) * mover.depth,
        });
        if (mover.foam > 0.2 && Math.random() < 0.5) {
          bubbles.push({ x: mover.x - mover.flip * Math.random() * 40, y: mover.y - 76 * mover.depth, life: 0.8, size: 2.5 + Math.random() * 3.5 });
        }
      }
    };

    const movePaper = (mover: Mover, dt: number, time: number) => {
      const swing = mover.phase * 0.85 + mover.seed;
      const flow = noise(mover.base * 0.003, mover.y * 0.003, time * 0.03);
      mover.base += flow * 6 * dt;
      // Blown aside by the pointer, and set swinging harder.
      if (pointer.on) {
        const px = mover.x - pointer.x;
        const py = mover.y - pointer.y;
        const distance = Math.hypot(px, py) || 1;
        if (distance < 140) {
          const push = ((140 - distance) / 140) ** 2 * 260 * dt;
          mover.base += (px / distance) * push;
          mover.y += (py / distance) * push * 0.6;
          mover.phase += push * 0.02;
        }
      }
      mover.x = mover.base + Math.sin(swing) * 30 * mover.depth;
      mover.y += (5 + 11 * Math.abs(Math.cos(swing))) * mover.depth * dt;
      mover.tilt = Math.cos(swing) * 0.4;
      // It turns over slowly as it falls: a receipt shows its blank back.
      mover.flip = Math.cos(mover.phase * 0.5 + mover.seed);
      if (mover.y > height + 60) {
        mover.y = -60;
        mover.base = sideX();
      }
      mover.flash = Math.max(0, mover.flash - dt * 1.6);
    };

    const step = (dt: number, time: number, scanY: number) => {
      for (const mover of movers) {
        mover.phase += dt;
        if (mover.kind === 'cart') moveCart(mover, dt, time);
        else if (mover.kind === 'car') moveCar(mover, dt, time);
        else movePaper(mover, dt, time);
        // Out one side, back in the other (a car comes back freshly washed).
        const margin = 80;
        if (mover.x < -margin || mover.x > width + margin) {
          mover.x = mover.x < 0 ? width + margin : -margin;
          if (mover.kind === 'car') mover.foam = 1;
          else mover.base = mover.x;
        }
        if (mover.kind === 'cart' && mover.y < -margin) mover.y = height + margin;
        if (mover.kind === 'cart' && mover.y > height + margin) mover.y = -margin;
        // The scanner beeps a label as it reads it.
        const onBeam = Math.abs(mover.y - scanY) < 8;
        if (mover.kind === 'barcode' && onBeam && !mover.scanned) {
          mover.flash = 1;
          ripples.push({ x: mover.x, y: mover.y, age: 0, strength: 0.6 * mover.depth });
        }
        mover.scanned = onBeam;
      }
      for (const ripple of ripples) ripple.age += dt;
      while (ripples.length > 0 && ripples[0]!.age > 2.4) ripples.shift();
      for (const bubble of bubbles) {
        bubble.life -= dt / 2.6;
        bubble.y -= dt * 12;
        bubble.x += Math.sin(bubble.life * 8 + bubble.y * 0.05) * dt * 6;
      }
      while (bubbles.length > 0 && bubbles[0]!.life <= 0) bubbles.shift();
      pointer.glow += ((pointer.on ? 1 : 0) - pointer.glow) * ease(dt, 4);
    };

    // Paint the shapes onto the small scene canvas, one pixel per dot.
    const paintScene = () => {
      paint.setTransform(1, 0, 0, 1, 0, 0);
      paint.clearRect(0, 0, columns, rows);
      const ordered = [...movers].sort((a, b) => a.depth - b.depth);
      for (const mover of ordered) {
        dim = 0.45 + 0.55 * mover.depth;
        paint.setTransform(1 / GAP, 0, 0, 1 / GAP, 0, 0);
        paint.translate(mover.x, mover.y + (mover.kind === 'car' ? Math.sin(mover.phase * 9 + mover.seed) * 0.6 : 0));
        paint.rotate(mover.tilt);
        paint.scale(mover.flip * mover.depth * SIZE, mover.depth * SIZE);
        if (mover.kind === 'cart') {
          const rattle = Math.sin(mover.phase * 23) * Math.min(1.2, mover.speed / 22);
          drawCart(paint, shade, { wheel: mover.wheel, load: mover.detail, rattle });
        } else if (mover.kind === 'car') {
          drawCar(paint, shade, { wheel: mover.wheel, foam: mover.foam, seed: mover.seed, beam: mover.depth === 1 });
        } else if (mover.kind === 'receipt') {
          drawReceipt(paint, shade, { curl: Math.sin(mover.phase * 1.3 + mover.seed) * 5, back: mover.flip < 0, lines: mover.detail });
        } else {
          drawBarcode(paint, shade, { flash: mover.flash, bars: mover.detail });
        }
      }
      dim = 1;
      paint.setTransform(1 / GAP, 0, 0, 1 / GAP, 0, 0);
      paint.lineWidth = 1.6;
      for (const bubble of bubbles) {
        paint.strokeStyle = shade(0.95, bubble.life);
        paint.beginPath();
        paint.arc(bubble.x, bubble.y, bubble.size + (1 - bubble.life) * 3, 0, Math.PI * 2);
        paint.stroke();
      }
    };

    const draw = (dt: number, time: number, scanY: number) => {
      paintScene();
      const pixels = paint.getImageData(0, 0, columns, rows).data;
      const fade = Math.exp(-dt * 1.6);
      framePixels.fill(0);
      const pitch = frameImage.width;
      for (let row = 0; row < rows; row++) {
        const y = GAP / 2 + row * GAP;
        const beam = Math.exp(-(((y - scanY) / 5) ** 2)) * 0.35;
        const pointerRow = pointer.glow > 0.01 && Math.abs(y - pointer.y) < 110;
        const rowRipples = ripples.filter((ripple) => Math.abs(y - ripple.y) < ripple.age * 90 + 6);
        const top = Math.round((y - GAP / 2) * ratio) * pitch;
        for (let column = 0; column < columns; column++) {
          const index = row * columns + column;
          const x = GAP / 2 + column * GAP;
          const cover = pixels[index * 4 + 3]! / 255;
          const light = pixels[index * 4]! / 255;
          // The map breathes a little, and brightens in a wake for a while after something passes.
          let ground = field[index]! * (0.8 + 0.2 * Math.sin(time * 0.9 + twinkle[index]!));
          wake[index] = Math.max(wake[index]! * fade, cover * 0.8);
          ground += wake[index]! * (0.12 + field[index]!) * (1 - cover);
          ground += beam * (0.3 + field[index]!);
          if (pointerRow) {
            const reach = 1 - Math.hypot(x - pointer.x, y - pointer.y) / 110;
            if (reach > 0) ground += reach * reach * pointer.glow * (0.12 + field[index]! * 0.9);
          }
          for (const ripple of rowRipples) {
            const off = Math.abs(Math.hypot(x - ripple.x, y - ripple.y) - ripple.age * 90);
            if (off < 6) ground += (1 - off / 6) * ripple.strength * (1 - ripple.age / 2.4);
          }
          const value = ground * (1 - cover) + light * cover;
          const level = Math.min(LEVELS - 1, Math.round(value * (LEVELS - 1)));
          if (level < 1) continue;
          const corner = top + Math.round((x - GAP / 2) * ratio);
          const offsets = stampOffsets[level]!;
          const colours = stampColours[level]!;
          for (let k = 0; k < offsets.length; k++) framePixels[corner + offsets[k]!] = colours[k]!;
        }
      }
      context.putImageData(frameImage, 0, 0);
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
      draw(dt, time, scanY);
      frame = requestAnimationFrame(tick);
    };

    const resize = () => {
      ratio = window.devicePixelRatio || 1;
      const first = width === 0;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      if (width === 0) {
        // Hidden (phones): nothing to draw.
        cancelAnimationFrame(frame);
        frame = 0;
        return;
      }
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      // A few spare rows and columns, so the last dots' pixels never run off the end.
      frameImage = context.createImageData(canvas.width + 8, canvas.height + 8);
      framePixels = new Uint32Array(frameImage.data.buffer);
      columns = Math.ceil(width / GAP);
      rows = Math.ceil(height / GAP);
      scene.width = columns;
      scene.height = rows;
      makeStamps();
      mapField();
      if (first || movers.length === 0) place();
      if (still) draw(0, 0, -100);
      else if (frame === 0) {
        last = 0;
        frame = requestAnimationFrame(tick);
      }
    };

    // The pointer lives on the panel: the canvas itself lets clicks through.
    const panel = canvas.parentElement;
    const onMove = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      pointer.x = event.clientX - box.left;
      pointer.y = event.clientY - box.top;
      pointer.on = event.pointerType === 'mouse';
    };
    const onLeave = () => {
      pointer.on = false;
    };
    panel?.addEventListener('pointermove', onMove);
    panel?.addEventListener('pointerleave', onLeave);

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      panel?.removeEventListener('pointermove', onMove);
      panel?.removeEventListener('pointerleave', onLeave);
    };
  }, []);
  return <canvas ref={ref} className="shop-drift" aria-hidden="true" />;
}
