/**
 * The page numbers worth showing under a list: the first and last, and the ones
 * around the current page; 'gap' stands for the pages left out between them.
 * Seven places at most, so the row never changes width as you page through.
 */
export function pageWindow(page: number, count: number): Array<number | 'gap'> {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);
  const start = Math.max(2, Math.min(page - 1, count - 4));
  const end = Math.min(count - 1, Math.max(page + 1, 5));
  const middle = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  return [1, ...(start > 2 ? ['gap' as const] : []), ...middle, ...(end < count - 1 ? ['gap' as const] : []), count];
}
