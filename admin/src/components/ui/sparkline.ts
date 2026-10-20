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

/** One bar of a mini graph, in drawing units. */
export interface SparkBar {
  x: number;
  y: number;
  width: number;
  height: number;
  latest: boolean;
}

/**
 * A mini graph of `values`, oldest first, as one bar per day standing on the
 * bottom edge: each bar is a real day, so nothing is drawn between them that
 * didn't happen (a smoothed line turned one sale into a hill). Days with
 * nothing (or refunds) leave the floor bare; quiet days keep a sliver. An
 * outlier runs to the top so the rest keep their shape. Null when every day
 * is empty, so the card can say "No data".
 */
export function sparkBars(values: number[], width = SPARK_WIDTH, height = SPARK_HEIGHT): SparkBar[] | null {
  if (!values.some((value) => value > 0)) return null;
  const { top } = scaleTop(values);
  const slot = width / values.length;
  // A gap of a third of the slot, but never wider than the bars get thin.
  const barWidth = round(Math.max(1, slot * 0.66));
  const bars: SparkBar[] = [];
  values.forEach((value, index) => {
    if (value <= 0) return;
    const barHeight = round(Math.max(2, Math.min(1, value / top) * (height - PAD)));
    bars.push({ x: round(index * slot + (slot - barWidth) / 2), y: round(height - barHeight), width: barWidth, height: barHeight, latest: index === values.length - 1 });
  });
  return bars;
}

/** Which way a change points; null when there's nothing to compare with. */
export function changeDirection(change: number | null): 'up' | 'down' | 'flat' | null {
  if (change === null) return null;
  if (change > 0) return 'up';
  if (change < 0) return 'down';
  return 'flat';
}
