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

/** Which way a change points; null when there's nothing to compare with. */
export function changeDirection(change: number | null): 'up' | 'down' | 'flat' | null {
  if (change === null) return null;
  if (change > 0) return 'up';
  if (change < 0) return 'down';
  return 'flat';
}
