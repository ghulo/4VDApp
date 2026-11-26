/** Where the item now at `from` lands when moved to `to`, the rest closing up behind it. */
export function moveItem<Item>(items: Item[], from: number, to: number): Item[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** The place a dragged row is over, from how far its middle has travelled past the other rows' middles. */
export function dropIndex(middles: number[], from: number, middle: number): number {
  let to = from;
  for (let index = from + 1; index < middles.length && middle > middles[index]!; index++) to = index;
  for (let index = from - 1; index >= 0 && middle < middles[index]!; index--) to = index;
  return to;
}
