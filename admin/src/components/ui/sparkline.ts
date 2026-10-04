/** Rows of blocks in a metric card's mini graph. */
export const SPARK_ROWS = 10;
/** Columns in a metric card's mini graph (twice as many on a large card), so blocks stay near square. */
export const SPARK_COLUMNS = 36;

/**
 * A metric card's mini graph as printed blocks: for each of `columns` columns
 * (oldest first), how many of the `rows` blocks are lit. Long series are
 * averaged down and short ones repeated across columns, so the graph always
 * fills the card; any non-zero value lights at least one block. Null when there's nothing to draw (no points, or every point is
 * zero), so the card can say "No data".
 */
export function sparkBlocks(values: number[], rows = SPARK_ROWS, columns = SPARK_COLUMNS): number[] | null {
  if (values.length === 0 || values.every((value) => value === 0)) return null;
  const averaged = Array.from({ length: columns }, (_, column) => {
    const start = Math.floor((column * values.length) / columns);
    const end = Math.max(start + 1, Math.floor(((column + 1) * values.length) / columns));
    const bucket = values.slice(start, end);
    return bucket.reduce((sum, value) => sum + value, 0) / bucket.length;
  });
  // Refunds can make a day negative: blocks count up from the lowest day, or from zero.
  const min = Math.min(0, ...averaged);
  const span = Math.max(...averaged) - min || 1;
  return averaged.map((value) => {
    const lit = Math.round(((value - min) / span) * rows);
    return value !== 0 && lit === 0 ? 1 : lit;
  });
}

/** Which way a change points; null when there's nothing to compare with. */
export function changeDirection(change: number | null): 'up' | 'down' | 'flat' | null {
  if (change === null) return null;
  if (change > 0) return 'up';
  if (change < 0) return 'down';
  return 'flat';
}
