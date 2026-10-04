import { describe, expect, it } from 'vitest';
import { PIXEL_ART, PIXEL_GRID, pixelCells } from './pixelDrawings';

describe('PIXEL_ART', () => {
  it.each(Object.entries(PIXEL_ART))('should draw %s on a square grid', (_name, rows) => {
    expect(rows).toHaveLength(PIXEL_GRID);
    for (const row of rows) expect(row).toMatch(new RegExp(`^[.#]{${PIXEL_GRID}}$`));
  });

  it('should list the filled blocks', () => {
    expect(pixelCells('crate')).toContainEqual({ x: 1, y: 1 });
    expect(pixelCells('crate')).not.toContainEqual({ x: 0, y: 0 });
  });
});
