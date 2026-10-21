/**
 * The shop drawn as shapes for the sign-in page's dot field. Each picture is
 * drawn in its own space, facing right, onto a small canvas where every pixel
 * becomes one dot: red is how bright the dot is, alpha how much the picture
 * covers the noise behind it. So `shade(light, cover)` is the only paint.
 */
export type Shade = (light: number, cover?: number) => string;
type Paint = CanvasRenderingContext2D;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A shopping cart seen from the side, standing on its wheels at (0, 0). */
export function drawCart(g: Paint, shade: Shade, cart: { wheel: number; load: number[]; rattle: number }) {
  const [top, bottom] = [-54 + cart.rattle, -22 + cart.rattle];
  const leftAt = (y: number) => lerp(-36, -30, (y - top) / (bottom - top));
  const rightAt = (y: number) => lerp(32, 26, (y - top) / (bottom - top));
  // The shopping, sticking up over the rim (the basket's front hides the rest).
  cart.load.forEach((height, i) => {
    g.fillStyle = shade(0.5 + (i % 3) * 0.15);
    if (i % 3 === 1) {
      // A bottle: a body and a neck.
      g.fillRect(-25 + i * 13, top - height, 8, height + 8);
      g.fillRect(-23 + i * 13, top - height - 8, 4, 9);
    } else {
      g.fillRect(-27 + i * 13, top - height, 12, height + 8);
    }
  });
  // The basket: dark inside, wires and a bright rim.
  g.beginPath();
  g.moveTo(-36, top);
  g.lineTo(32, top);
  g.lineTo(26, bottom);
  g.lineTo(-30, bottom);
  g.closePath();
  g.fillStyle = shade(0.2);
  g.fill();
  g.strokeStyle = shade(0.75);
  g.lineWidth = 1.8;
  g.beginPath();
  for (let k = 1; k < 8; k++) {
    const t = k / 8;
    g.moveTo(lerp(-36, 32, t), top);
    g.lineTo(lerp(-30, 26, t), bottom);
  }
  for (const y of [top + 11, top + 22]) {
    g.moveTo(leftAt(y), y);
    g.lineTo(rightAt(y), y);
  }
  g.stroke();
  g.strokeStyle = shade(1);
  g.lineWidth = 3.4;
  g.beginPath();
  g.moveTo(-30, bottom);
  g.lineTo(-36, top);
  g.lineTo(32, top);
  g.lineTo(26, bottom);
  g.stroke();
  // Handle and grip.
  g.lineWidth = 2.6;
  g.beginPath();
  g.moveTo(-36, top);
  g.lineTo(-47, top - 9);
  g.stroke();
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(-50, top - 11);
  g.lineTo(-44, top - 7);
  g.stroke();
  // Frame and the bottom shelf.
  g.strokeStyle = shade(0.82);
  g.lineWidth = 2.6;
  g.beginPath();
  g.moveTo(-30, bottom);
  g.lineTo(-30, -9);
  g.lineTo(24, -9);
  g.lineTo(26, bottom);
  g.moveTo(-26, -14);
  g.lineTo(22, -14);
  g.stroke();
  // Wheels: bright tyres, a dark hub and a spoke that turns as it rolls.
  for (const x of [-25, 19]) {
    g.fillStyle = shade(1);
    g.beginPath();
    g.arc(x, -5, 5.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = shade(0.15);
    g.beginPath();
    g.arc(x, -5, 2.4, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = shade(0.3);
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x, -5);
    g.lineTo(x + Math.cos(cart.wheel) * 5, -5 + Math.sin(cart.wheel) * 5);
    g.stroke();
  }
}

/** A small car from the side, wheels on the road at (0, 0), fresh from the wash. */
export function drawCar(g: Paint, shade: Shade, car: { wheel: number; foam: number; seed: number; beam: boolean }) {
  // The headlight's beam on the road ahead: light without covering the noise much.
  if (car.beam) {
    const beam = g.createLinearGradient(58, 0, 190, 0);
    beam.addColorStop(0, shade(1, 0.42));
    beam.addColorStop(1, shade(1, 0));
    g.fillStyle = beam;
    g.beginPath();
    g.moveTo(57, -22);
    g.lineTo(190, -46);
    g.lineTo(190, 10);
    g.closePath();
    g.fill();
  }
  // Body.
  g.beginPath();
  g.moveTo(-60, -10);
  g.lineTo(-60, -26);
  g.quadraticCurveTo(-58, -31, -44, -31);
  g.lineTo(-30, -48);
  g.quadraticCurveTo(-26, -51, -18, -51);
  g.lineTo(12, -51);
  g.quadraticCurveTo(18, -51, 22, -47);
  g.lineTo(36, -32);
  g.quadraticCurveTo(56, -30, 60, -22);
  g.lineTo(60, -10);
  g.closePath();
  g.fillStyle = shade(0.5);
  g.fill();
  g.strokeStyle = shade(1);
  g.lineWidth = 3.2;
  g.stroke();
  // Windows: dark glass with a streak of light across.
  g.fillStyle = shade(0.05);
  g.beginPath();
  g.moveTo(-38, -32);
  g.lineTo(-26, -46);
  g.lineTo(-6, -46);
  g.lineTo(-6, -32);
  g.closePath();
  g.moveTo(-1, -46);
  g.lineTo(13, -46);
  g.lineTo(27, -32);
  g.lineTo(-1, -32);
  g.closePath();
  g.fill();
  g.strokeStyle = shade(0.55);
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(-20, -34);
  g.lineTo(-12, -45);
  g.moveTo(6, -34);
  g.lineTo(12, -42);
  g.stroke();
  // Door line and handle.
  g.strokeStyle = shade(0.6);
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(-4, -31);
  g.lineTo(-4, -12);
  g.moveTo(4, -26);
  g.lineTo(10, -26);
  g.stroke();
  // Head and tail lights.
  g.fillStyle = shade(1);
  g.fillRect(53, -26, 7, 5);
  g.fillStyle = shade(0.8);
  g.fillRect(-60, -26, 4, 6);
  // Wheels: dark tyres, a bright rim, a spoke that turns.
  for (const x of [-36, 36]) {
    g.fillStyle = shade(0.06);
    g.beginPath();
    g.arc(x, -10, 10, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = shade(0.95);
    g.lineWidth = 2.6;
    g.beginPath();
    g.arc(x, -10, 6.5, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 2.2;
    g.beginPath();
    for (const turn of [0, Math.PI / 2]) {
      g.moveTo(x + Math.cos(car.wheel + turn) * 6, -10 + Math.sin(car.wheel + turn) * 6);
      g.lineTo(x - Math.cos(car.wheel + turn) * 6, -10 - Math.sin(car.wheel + turn) * 6);
    }
    g.stroke();
  }
  // Soap foam still on the roof and the bonnet, shrinking as it dries.
  if (car.foam > 0) {
    g.fillStyle = shade(0.95);
    for (let i = 0; i < 9; i++) {
      const x = -24 + i * 6 + Math.sin(car.seed + i * 2.1) * 3;
      const y = i < 7 ? -52 : -34;
      const r = (2.4 + Math.abs(Math.sin(car.seed * 3 + i)) * 3) * car.foam;
      g.beginPath();
      g.arc(i < 7 ? x : x + 14, y - r * 0.4, r, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/** A till receipt, centred on (0, 0), its paper curling as it falls; `back` shows the blank side. */
export function drawReceipt(g: Paint, shade: Shade, receipt: { curl: number; back: boolean; lines: number[] }) {
  const [half, top, bottom] = [15, -36, 34];
  const bend = (y: number) => Math.sin(((y - top) / (bottom - top)) * Math.PI) * receipt.curl;
  // The paper, with a torn zigzag foot.
  g.beginPath();
  g.moveTo(-half + bend(top), top);
  g.lineTo(half + bend(top), top);
  for (let y = top; y <= bottom; y += 7) g.lineTo(half + bend(y), y);
  for (let x = half; x >= -half; x -= 5) g.lineTo(x + bend(bottom), bottom + ((x / 5) % 2 === 0 ? 0 : 4));
  for (let y = bottom; y >= top; y -= 7) g.lineTo(-half + bend(y), y);
  g.closePath();
  g.fillStyle = shade(receipt.back ? 0.4 : 0.78);
  g.fill();
  g.strokeStyle = shade(0.9);
  g.lineWidth = 1.6;
  g.stroke();
  if (receipt.back) return;
  // Printing: dark on the bright paper, a bold header and total.
  g.strokeStyle = shade(0.08);
  g.lineCap = 'butt';
  g.lineWidth = 4.5;
  g.beginPath();
  g.moveTo(-8 + bend(-28), -28);
  g.lineTo(8 + bend(-28), -28);
  g.stroke();
  g.lineWidth = 2.4;
  g.beginPath();
  receipt.lines.forEach((length, i) => {
    const y = -18 + i * 7;
    g.moveTo(-11 + bend(y), y);
    g.lineTo(-11 + length + bend(y), y);
    g.moveTo(6 + bend(y), y);
    g.lineTo(11 + bend(y), y);
  });
  g.stroke();
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(-11 + bend(24), 24);
  g.lineTo(11 + bend(24), 24);
  g.stroke();
}

/** A barcode label, centred on (0, 0); `flash` lights it as the scanner reads it. */
export function drawBarcode(g: Paint, shade: Shade, label: { flash: number; bars: number[] }) {
  g.beginPath();
  g.roundRect(-32, -22, 64, 44, 6);
  g.fillStyle = shade(0.82 + label.flash * 0.18);
  g.fill();
  g.strokeStyle = shade(1);
  g.lineWidth = 1.6;
  g.stroke();
  // Bars of one or two dots' width, with gaps between.
  g.fillStyle = shade(0.04 + label.flash * 0.25);
  let x = -26;
  label.bars.forEach((width, i) => {
    if (i % 2 === 0) g.fillRect(x, -16, width, 24);
    x += width;
  });
  // The digits under the bars.
  g.fillStyle = shade(0.12);
  for (let i = 0; i < 6; i++) g.fillRect(-24 + i * 8, 12, 5, 3);
}
