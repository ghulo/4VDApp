import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SortableList } from './SortableList';
import { dropIndex, moveItem } from './sortableMath';

describe('moveItem', () => {
  it('takes the item out and puts it in its new place, the rest closing up', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});

describe('dropIndex', () => {
  // Rows 40px apart, middles at 20, 60, 100, 140.
  const middles = [20, 60, 100, 140];
  it('stays put until the dragged middle passes a neighbour’s middle', () => {
    expect(dropIndex(middles, 1, 60 + 39)).toBe(1);
    expect(dropIndex(middles, 1, 60 + 41)).toBe(2);
    expect(dropIndex(middles, 1, 200)).toBe(3);
  });
  it('moves up the same way, and never past the ends', () => {
    expect(dropIndex(middles, 2, 100 - 41)).toBe(1);
    expect(dropIndex(middles, 2, -500)).toBe(0);
  });
});

describe('SortableList', () => {
  it('draws a grip key per row named after the item', () => {
    const html = renderToStaticMarkup(
      <SortableList items={['Bread', 'Milk']} itemKey={(item) => item} itemName={(item) => item} onReorder={() => undefined} renderItem={(item) => <span>{item}</span>} />,
    );
    expect(html).toContain('aria-label="Move Bread: drag, or use the up and down arrows"');
    expect(html.match(/sortable__grip/g)).toHaveLength(2);
    expect(html).toContain('aria-live="assertive"');
  });
});
