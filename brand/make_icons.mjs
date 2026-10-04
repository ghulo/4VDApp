// Draws every PNG app icon from brand/logo-mark.svg, so the icons can never
// drift from the mark. Run from the repo root: node brand/make_icons.mjs
// (uses the backend's sharp; run `npm install` in backend/ first).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const sharp = createRequire(new URL('../backend/package.json', import.meta.url))('sharp');
const IVORY = '#FAF9F5';
const mark = readFileSync(new URL('./logo-mark.svg', import.meta.url), 'utf8');
// The tile has a hairline edge so it shows on ivory; icons the phone frames itself drop it.
const TILE = '<rect x="0.5" y="0.5" width="63" height="63" rx="13.5" fill="#FAF9F5" stroke="#E3DACC"/>';
if (!mark.includes(TILE)) throw new Error('logo-mark.svg changed its tile; update make_icons.mjs');

// Phone home screens round the corners themselves, so those icons fill the square.
const square = mark.replace(TILE, '<rect width="64" height="64" fill="#FAF9F5"/>');
// Android lays the mark over its own background, so that one has no tile at all.
const bare = mark.replace(TILE, '');
// Android's themed icon keeps only the shape, so it gets the ink parts alone (no sun or stripes).
const inkOnly = bare.replace(/\s*<circle[^>]*\/>/, '').replace(/\s*<rect[^>]*fill="#FAF9F5"\/>/g, '');
if (inkOnly.includes('#D4704F') || inkOnly.includes('#FAF9F5')) throw new Error('could not strip the sun from logo-mark.svg');

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

const onIvory = (image) => image.flatten({ background: IVORY });

// Home-screen icons for both web apps: the team app and the dashboard.
for (const app of ['mobile', 'admin']) {
  await (await render(square, 180)).png().toFile(fileIn(app, 'public/apple-touch-icon.png'));
  await (await render(square, 192)).png().toFile(fileIn(app, 'public/icon-192.png'));
  await (await render(square, 512)).png().toFile(fileIn(app, 'public/icon-512.png'));
  await onIvory(await render(bare, 512, 0.06)).png().toFile(fileIn(app, 'public/icon-maskable-512.png'));
}
await (await render(mark, 48)).png().toFile(out('assets/favicon.png'));
await (await render(square, 1024)).png().toFile(out('assets/icon.png'));
await (await render(bare, 1024, 0.1)).png().toFile(out('assets/android-icon-foreground.png'));
await sharp({ create: { width: 1024, height: 1024, channels: 3, background: IVORY } }).png().toFile(out('assets/android-icon-background.png'));
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
