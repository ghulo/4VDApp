/**
 * Code 128 (set B) as an SVG, for a document number like "F-2026-000042":
 * every shop scanner reads it, and it needs no library. Black bars on white,
 * since scanners read only that.
 */

// Bar and space widths, in modules, for each symbol value 0–106 (106 = stop).
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const STOP = 106;
/** Blank modules each side, so the scanner finds where the code starts. */
const QUIET_ZONE = 10;

/** The symbol values for `text` in set B, with the start, checksum and stop. Printable ASCII only. */
export function code128Values(text: string): number[] {
  const data = [...text].map((char) => {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error(`Code 128 B cannot hold "${char}"`);
    return code - 32;
  });
  const checksum = data.reduce((sum, value, index) => sum + value * (index + 1), START_B) % 103;
  return [START_B, ...data, checksum, STOP];
}

/** The barcode as an SVG `height` units tall; it scales to whatever width the page gives it. */
export function code128Svg(text: string, height = 40): string {
  let x = QUIET_ZONE;
  const bars: string[] = [];
  for (const value of code128Values(text)) {
    [...PATTERNS[value]!].forEach((width, index) => {
      // Even positions are bars, odd ones spaces.
      if (index % 2 === 0) bars.push(`<rect x="${x}" width="${width}" height="${height}"/>`);
      x += Number(width);
    });
  }
  const total = x + QUIET_ZONE;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges"><rect width="${total}" height="${height}" fill="#fff"/><g fill="#000">${bars.join('')}</g></svg>`;
}
