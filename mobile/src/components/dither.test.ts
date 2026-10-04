import { describe, expect, it } from 'vitest';
import { dither, inShop, shopSunrise } from './dither';

describe('dither', () => {
  it('should print full ink as one run per row', () => {
    expect(dither(8, 2, () => 1)).toEqual([
      { x: 0, y: 0, length: 8 },
      { x: 0, y: 1, length: 8 },
    ]);
  });

  it('should print no ink as nothing', () => expect(dither(8, 8, () => 0)).toEqual([]));

  it('should print half ink as about half the blocks', () => {
    const filled = dither(16, 16, () => 0.5).reduce((sum, run) => sum + run.length, 0);
    expect(filled).toBe(128);
  });
});

describe('shopSunrise', () => {
  it('should keep every block on the grid', () => {
    const { shop, sun } = shopSunrise(80, 32);
    for (const run of [...shop, ...sun]) {
      expect(run.x).toBeGreaterThanOrEqual(0);
      expect(run.x + run.length).toBeLessThanOrEqual(80);
      expect(run.y).toBeLessThan(32);
    }
    expect(shop.length).toBeGreaterThan(0);
    expect(sun.length).toBeGreaterThan(0);
  });

  it('should draw the pillars but not the gaps between them', () => {
    expect(inShop(17, 40)).toBe(true);
    expect(inShop(22, 40)).toBe(false);
  });
});
