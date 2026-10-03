/** Size of the mini graph's drawing area; the SVG stretches it to the card's width. */
export const SPARK_WIDTH = 300;
export const SPARK_HEIGHT = 64;
/** Keeps the line's stroke from being clipped at the top. */
const PAD = 3;

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * SVG paths for a filled mini graph of `values`, oldest first: the line, and
 * the area under it down to the bottom edge. Null when there's nothing to draw
 * (no points, or every point is zero), so the card can say "No data".
 */
export function sparklinePaths(values: number[], width = SPARK_WIDTH, height = SPARK_HEIGHT): { line: string; area: string } | null {
  if (values.length === 0 || values.every((value) => value === 0)) return null;
  // One point is drawn as a flat line across the card.
  const series = values.length === 1 ? [values[0]!, values[0]!] : values;
  const max = Math.max(...series);
  const min = Math.min(0, ...series);
  const span = max - min || 1;
  const step = width / (series.length - 1);
  const points = series.map((value, index) => [round(index * step), round(PAD + (height - PAD) * (1 - (value - min) / span))] as const);
  const line = `M${points.map(([x, y]) => `${x},${y}`).join(' L')}`;
  const area = `${line} L${points.at(-1)![0]},${height} L${points[0]![0]},${height} Z`;
  return { line, area };
}

/** A soft wave shown faintly behind "No data", like an empty instrument. */
export const PLACEHOLDER_WAVE =
  'M0,44 C25,44 35,36 55,38 C75,40 85,50 105,48 C125,46 135,30 155,30 C175,30 185,46 205,46 C225,46 235,36 255,38 C275,40 285,48 300,46';

/** Which way a change points; null when there's nothing to compare with. */
export function changeDirection(change: number | null): 'up' | 'down' | 'flat' | null {
  if (change === null) return null;
  if (change > 0) return 'up';
  if (change < 0) return 'down';
  return 'flat';
}
