/** Size of the mini graph's drawing area. The SVG is stretched to the card, so
 * only flat fills and non-scaling strokes are drawn in it, nothing round. */
export const SPARK_WIDTH = 300;
export const SPARK_HEIGHT = 56;
/** Keeps the line's stroke from being clipped at the top. */
const PAD = 3;

const round = (n: number) => Math.round(n * 10) / 10;

/** A top value more than this many times the next highest counts as an outlier. */
export const OUTLIER_RATIO = 4;

/**
 * What a graph should scale to (DESIGN.md 10.7): the highest value, unless one
 * value is more than four times the next highest. Then the graph scales to
 * the rest (with a little headroom) and `outlier` says which value runs off
 * the top, so one huge day doesn't flatten every other.
 */
export function scaleTop(values: number[]): { top: number; outlier: number | null } {
  let first = 0;
  let second = 0;
  let firstIndex = -1;
  values.forEach((value, index) => {
    if (value > first) {
      second = first;
      first = value;
      firstIndex = index;
    } else if (value > second) {
      second = value;
    }
  });
  if (second > 0 && first > OUTLIER_RATIO * second) return { top: second * 1.25, outlier: firstIndex };
  return { top: first, outlier: null };
}

/**
 * SVG paths for a mini graph of `values`, oldest first: a smooth line, and
 * the area under it down to the bottom edge. The curve bends through the
 * midpoints between days, so it never overshoots a real value. Null when there's nothing to draw
 * (no points, or every point is zero), so the card can say "No data".
 */
export function sparklinePaths(values: number[], width = SPARK_WIDTH, height = SPARK_HEIGHT): { line: string; area: string } | null {
  if (values.length === 0 || values.every((value) => value === 0)) return null;
  // One point is drawn as a flat line across the card.
  const raw = values.length === 1 ? [values[0]!, values[0]!] : values;
  // An outlier is drawn at the top edge, so the other days keep their shape.
  const { top } = scaleTop(raw);
  const series = raw.map((value) => Math.min(value, top));
  const max = Math.max(...series);
  const min = Math.min(0, ...series);
  const span = max - min || 1;
  const step = width / (series.length - 1);
  const points = series.map((value, index) => [round(index * step), round(PAD + (height - PAD) * (1 - (value - min) / span))] as const);
  const mid = (a: readonly [number, number], b: readonly [number, number]) => `${round((a[0] + b[0]) / 2)},${round((a[1] + b[1]) / 2)}`;
  const curves = points.slice(1, -1).map((point, index) => `Q${point[0]},${point[1]} ${mid(point, points[index + 2]!)}`);
  const [first, second, last] = [points[0]!, points[1]!, points.at(-1)!];
  const line = [`M${first[0]},${first[1]}`, `L${mid(first, second)}`, ...curves, `L${last[0]},${last[1]}`].join(' ');
  const area = `${line} L${points.at(-1)![0]},${height} L${points[0]![0]},${height} Z`;
  return { line, area };
}

/** Which way a change points; null when there's nothing to compare with. */
export function changeDirection(change: number | null): 'up' | 'down' | 'flat' | null {
  if (change === null) return null;
  if (change > 0) return 'up';
  if (change < 0) return 'down';
  return 'flat';
}
