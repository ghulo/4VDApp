// Draws the installer's pictures from the 4VD mark: the tall picture beside the
// welcome and finish pages, and the strip at the top of the progress page.
// NSIS only reads 24-bit BMP files, which sharp can't write, so this writes them itself.
// Run from the repo root: `node desktop/build/make_installer_art.mjs`
// (uses the backend's sharp; run `npm install` in backend/ first).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const sharp = createRequire(new URL('../../backend/package.json', import.meta.url))('sharp');
const here = (name) => new URL(`./${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Colours from DESIGN.md.
const CANVAS = '#f0eee6';
const HAIRLINE = '#e0dbcf';
const INK = '#141413';
const MUTED = '#5e5d59';

// The mark's drawing without its tile, so it can sit straight on the canvas.
const markSvg = readFileSync(new URL('../../brand/logo-mark.svg', import.meta.url), 'utf8');
const markInner = markSvg
  .replace(/<svg[^>]*>|<\/svg>|<!--[\s\S]*?-->/g, '')
  .replace(/<rect x="0\.5"[^>]*\/>/, '')
  .replace(/id="above-ground"/g, 'id="sun-clip"')
  .replace(/url\(#above-ground\)/g, 'url(#sun-clip)')
  .replace(/fill="#FAF9F5"/g, `fill="${CANVAS}"`);

function mark(x, y, size) {
  return `<g transform="translate(${x} ${y}) scale(${size / 64})">${markInner}</g>`;
}

// The sidebar beside the welcome and finish pages (MUI asks for 164 × 314).
const sidebar = `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <rect width="164" height="314" fill="${CANVAS}"/>
  <rect x="163" width="1" height="314" fill="${HAIRLINE}"/>
  ${mark(22, 150, 120)}
  <text x="82" y="292" text-anchor="middle" font-family="Hanken Grotesk, Segoe UI, sans-serif" font-weight="700" font-size="22" letter-spacing="-0.5" fill="${INK}">4VD</text>
</svg>`;

// The strip at the top of the progress page (MUI asks for 150 × 57).
const header = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <rect width="150" height="57" fill="#ffffff"/>
  ${mark(96, 6, 44)}
  <text x="92" y="36" text-anchor="end" font-family="Hanken Grotesk, Segoe UI, sans-serif" font-weight="700" font-size="18" letter-spacing="-0.4" fill="${MUTED}">4VD</text>
</svg>`;

async function writeBmp(svg, name) {
  const { data, info } = await sharp(Buffer.from(svg), { density: 72 }).flatten({ background: '#ffffff' }).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const out = Buffer.alloc(54 + rowSize * height);
  out.write('BM', 0);
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(rowSize * height, 34);
  // BMP rows run bottom to top, each pixel blue-green-red.
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * channels;
      out[row + x * 3] = data[from + 2];
      out[row + x * 3 + 1] = data[from + 1];
      out[row + x * 3 + 2] = data[from];
    }
  }
  writeFileSync(here(name), out);
  console.log(`${name}: ${width} × ${height}`);
}

await writeBmp(sidebar, 'installerSidebar.bmp');
await writeBmp(sidebar, 'uninstallerSidebar.bmp');
await writeBmp(header, 'installerHeader.bmp');
