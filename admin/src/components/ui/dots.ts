/** One dot in a dot-matrix bar: lit dots show the value, unlit ones the empty room above it. */
export interface Dot {
  x: number;
  y: number;
  lit: boolean;
}

interface DotColumnInput {
  /** Left edge of the bar. */
  x: number;
  /** The baseline the dots stack up from. */
  base: number;
  /** How tall the value is, in the same units. */
  height: number;
  /** How wide the bar may be; wider bars get more columns of dots. */
  width: number;
  /** Distance between dot centres. */
  step: number;
  /** Fill up to here with unlit dots (the top of the plot). Leave out for lit dots only. */
  top?: number;
}

/**
 * A bar drawn as a stack of dots, like the dotted waveforms on Cloudflare's site.
 * Any value above zero lights at least one dot, so small days still show.
 */
export function dotColumn({ x, base, height, width, step, top }: DotColumnInput): Dot[] {
  const lit = height > 0 ? Math.max(1, Math.round(height / step)) : 0;
  const rows = top === undefined ? lit : Math.max(lit, Math.floor((base - top) / step));
  const columns = Math.max(1, Math.floor(width / step));
  const firstX = x + (width - (columns - 1) * step) / 2;

  const dots: Dot[] = [];
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      dots.push({ x: firstX + column * step, y: base - step / 2 - row * step, lit: row < lit });
    }
  }
  return dots;
}
