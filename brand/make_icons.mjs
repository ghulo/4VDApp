// Draws every PNG app icon from brand/logo-mark.svg, so the icons can never
// drift from the mark. Run from the repo root: node brand/make_icons.mjs
// (uses the backend's sharp; run `npm install` in backend/ first).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const sharp = createRequire(new URL('../backend/package.json', import.meta.url))('sharp');
const AMBER = '#F5B71A';
const mark = readFileSync(new URL('./logo-mark.svg', import.meta.url), 'utf8');
// The mark is a solid amber tile (since 2026-10-20: the ivory one faded among other icons).
const TILE = '<rect width="64" height="64" rx="14" fill="#F5B71A"/>';
if (!mark.includes(TILE)) throw new Error('logo-mark.svg changed its tile; update make_icons.mjs');

// Phone home screens round the corners themselves, so those icons fill the square.
const square = mark.replace(TILE, '<rect width="64" height="64" fill="#F5B71A"/>');
// Maskable and splash icons lay the drawing on their own background, so they have no tile.
const bare = mark.replace(TILE, '');
// Android's themed icon keeps only the shape, so it gets the ink parts alone (no sun or stripes).
const inkOnly = bare.replace(/\s*<circle[^>]*\/>/, '').replace(/\s*<rect[^>]*height="1\.[48]" fill="#F5B71A"\/>/g, '');
if (inkOnly.includes('#F5B71A') || inkOnly.includes('#FFD073')) throw new Error('could not strip the sun from logo-mark.svg');

const fileIn = (app, path) => new URL(`../${app}/${path}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const out = (path) => fileIn('mobile', path);

/** Renders `svg` at `size` px; `padding` is the share of each side left empty (maskable icons get cropped). */
async function render(svg, size, padding = 0) {
  const inner = Math.round(size * (1 - 2 * padding));
  const art = await sharp(Buffer.from(svg), { density: Math.ceil((inner / 64) * 72 * 2) }).resize(inner, inner).png().toBuffer();
  if (padding === 0) return sharp(art);
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: art, gravity: 'centre' }]);
}

// Home-screen icons for the dashboard (and the retired team app, kept in step).
for (const app of ['mobile', 'admin']) {
  await (await render(square, 180)).png().toFile(fileIn(app, 'public/apple-touch-icon.png'));
  await (await render(square, 192)).png().toFile(fileIn(app, 'public/icon-192.png'));
  await (await render(square, 512)).png().toFile(fileIn(app, 'public/icon-512.png'));
  await (await render(bare, 512, 0.06)).flatten({ background: AMBER }).png().toFile(fileIn(app, 'public/icon-maskable-512.png'));
}
writeFileSync(fileIn('admin', 'public/favicon.svg'), mark);
// The emails show the mark at 48px; drawn at 3x for sharp phone screens. Served from the dashboard.
await (await render(mark, 144)).png().toFile(fileIn('admin', 'public/email-logo.png'));
// The Windows app's icon: taskbar, Start menu, installer.
await (await render(mark, 512)).png().toFile(fileIn('desktop', 'src/icon.png'));
await (await render(mark, 48)).png().toFile(out('assets/favicon.png'));
await (await render(square, 1024)).png().toFile(out('assets/icon.png'));
await (await render(bare, 1024, 0.1)).png().toFile(out('assets/android-icon-foreground.png'));
await sharp({ create: { width: 1024, height: 1024, channels: 3, background: AMBER } }).png().toFile(out('assets/android-icon-background.png'));
// Every drawn pixel in white; Android tints it to the phone's theme.
await (await render(inkOnly, 1024, 0.1))
  .ensureAlpha()
  .extractChannel('alpha')
  .raw()
  .toBuffer()
  .then((alpha) =>
    sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#ffffff' } })
      .joinChannel(alpha, { raw: { width: 1024, height: 1024, channels: 1 } })
      .png()
      .toFile(out('assets/android-icon-monochrome.png')),
  );
await (await render(bare, 1024, 0.1)).png().toFile(out('assets/splash-icon.png'));
console.log('Icons drawn from brand/logo-mark.svg');
