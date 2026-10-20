// Prints 4VD's colour scales for admin/src/styles/tokens.css (DESIGN.md 6). Run: node brand/make_palette.mjs
// OKLCH helpers
const hex2rgb = h => [1,3,5].map(i => parseInt(h.slice(i,i+2),16)/255);
const lin = c => c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4;
const delin = c => c <= 0.0031308 ? 12.92*c : 1.055*c**(1/2.4)-0.055;
function toOklch(h){const [r,g,b]=hex2rgb(h).map(lin);
const l=Math.cbrt(0.4122214708*r+0.5363325363*g+0.0514459929*b),m=Math.cbrt(0.2119034982*r+0.6806995451*g+0.1073969566*b),s=Math.cbrt(0.0883024619*r+0.2817188376*g+0.6299787005*b);
const L=0.2104542553*l+0.7936177850*m-0.0040720468*s,A=1.9779984951*l-2.4285922050*m+0.4505937099*s,B=0.0259040371*l+0.7827717662*m-0.8086757660*s;
return [L,Math.hypot(A,B),(Math.atan2(B,A)*180/Math.PI+360)%360];}
function oklabToRgb(L,A,B){const l=(L+0.3963377774*A+0.2158037573*B)**3,m=(L-0.1055613458*A-0.0638541728*B)**3,s=(L-0.0894841775*A-1.2914855480*B)**3;
return [4.0767416621*l-3.3077115913*m+0.2309699292*s,-1.2684380046*l+2.6097574011*m-0.3413193965*s,-0.0041960863*l-0.7034186147*m+1.7076147010*s];}
function fromOklch(L,C,H){ // reduce chroma until in gamut
 for(let c=C;c>=0;c-=0.001){const a=c*Math.cos(H*Math.PI/180),b=c*Math.sin(H*Math.PI/180);const rgb=oklabToRgb(L,a,b);
 if(rgb.every(v=>v>=-0.0001&&v<=1.0001)) return '#'+rgb.map(v=>Math.round(delin(Math.min(1,Math.max(0,v)))*255).toString(16).padStart(2,'0')).join('');}
}
const lum = h => {const [r,g,b]=hex2rgb(h).map(lin);return 0.2126*r+0.7152*g+0.0722*b};
const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)};


const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950, 975, 990];
// Lightness per step (OKLCH L), the same ladder as today's neutrals so contrast stays put.
const L = { 50: 0.98, 100: 0.96, 200: 0.925, 300: 0.885, 400: 0.79, 500: 0.69, 600: 0.585, 700: 0.475, 800: 0.40, 900: 0.30, 950: 0.215, 975: 0.17, 990: 0.125 };
// Share of a ramp's peak chroma per step: tints stay quiet, 500-700 carry the colour,
// the dark end fades to a whisper so dark-mode tints don't glow.
const CURVE = { 50: 0.1, 100: 0.2, 200: 0.32, 300: 0.48, 400: 0.9, 500: 0.95, 600: 1, 700: 0.9, 800: 0.6, 900: 0.3, 950: 0.18, 975: 0.12, 990: 0.07 };

const ramp = (hue, peak, lift = {}) =>
  Object.fromEntries(STEPS.map((s) => [s, fromOklch(L[s] + (lift[s] ?? 0), peak * CURVE[s], hue)]));

const neutral = Object.fromEntries(STEPS.map((s) => [s, fromOklch(L[s], s >= 900 ? 0.007 : 0.006, 235)]));
// Neutral 950 stays the ink of the logo.
neutral[950] = '#16191b';

// Amber: 400 is the brand and stays exact. Darker steps turn towards gold-brown
// (hue 83 → 66) so amber text reads warm, never olive.
const amberHue = { 50: 88, 100: 87, 200: 86, 300: 85, 400: 83, 500: 79, 600: 75, 700: 72, 800: 70, 900: 70, 950: 70, 975: 70, 990: 70 };
const amberAt = (s) => fromOklch(L[s], (s <= 300 ? 0.2 : 0.16) * CURVE[s] * (s >= 500 ? 1.05 : 1), amberHue[s]);
// Amber gets half steps too, for depth: a lit lip, a rim and a deeper foot on the
// same surface (150 selected wash, 250 rim, 350 key top, 450 key foot, 850/925 dark surfaces).
const HALF = [150, 250, 350, 450, 550, 650, 850, 925];
const amber = Object.fromEntries(STEPS.map((s) => [s, amberAt(s)]));
amber[400] = '#f5b71a';
// Each half step sits halfway between its two neighbours in OKLCH, so 350 is as vivid as the
// steps around it (the key's lit top) and 450 is the key's foot.
for (const h of HALF) {
  const lo = Math.max(...STEPS.filter((s) => s < h)), hi = Math.min(...STEPS.filter((s) => s > h));
  const [l1, c1, h1] = toOklch(amber[lo]), [l2, c2, h2] = toOklch(amber[hi]);
  amber[h] = fromOklch((l1 + l2) / 2, (c1 + c2) / 2, (h1 + h2) / 2);
}


const scales = {
  neutral,
  amber,
  green: ramp(152, 0.15, { 700: -0.025 }), // green looks lighter than it measures, so its word step sits a touch lower   // ok: a cool, clean green that sits with the anthracite
  orange: ramp(47, 0.175),   // warn: signal orange, halfway between amber and red
  red: ramp(25, 0.19),     // danger: a true red, not pink
  blue: ramp(250, 0.14),    // info: the anthracite's own blue, turned up
};

const out = Object.entries(scales).map(([name, r]) => '  ' + Object.keys(r).map(Number).sort((x, y) => x - y).map((s) => `--${name}-${s}: ${r[s]};`).join(' ')).join('\n');
console.log(out);

const report = (label, a, b) => console.error(label.padEnd(34), a, 'on', b, contrast(a, b).toFixed(2));
for (const n of ['green', 'orange', 'red', 'blue', 'amber']) {
  report(`${n} 700 on surface 50`, scales[n][700], neutral[50]);
  report(`${n} 700 on its tint 100`, scales[n][700], scales[n][100]);
  report(`${n} 400 on dark 950`, scales[n][400], neutral[950]);
  report(`${n} 400 on its dark tint 900`, scales[n][400], scales[n][900]);
  console.error('   ', n, [400, 700].map((s) => toOklch(scales[n][s]).map((v) => v.toFixed(3)).join('/')).join('  '));
}
