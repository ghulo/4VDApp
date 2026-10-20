import { describe, expect, it } from 'vitest';
import { changeDirection, scaleTop, sparkBars } from './sparkline';

describe('sparkBars', () => {
  it('should have nothing to draw for no data, all zeros or only refunds', () => {
    expect(sparkBars([])).toBeNull();
    expect(sparkBars([0, 0, 0])).toBeNull();
    expect(sparkBars([-5, 0])).toBeNull();
  });

  it('should draw one bar per day with a sale, standing on the floor, the last one marked', () => {
    const bars = sparkBars([0, 10, 5], 90, 53)!;
    expect(bars).toHaveLength(2);
    expect(bars[0]).toEqual({ x: 35.1, y: 3, width: 19.8, height: 50, latest: false });
    expect(bars[1]).toMatchObject({ x: 65.1, height: 25, latest: true });
  });

  it('should keep a quiet day visible as a sliver', () => {
    expect(sparkBars([100, 50, 1], 90, 53)![2]!.height).toBe(2);
  });
});

describe('scaleTop', () => {
  it('should scale to the highest value when nothing stands far out', () => {
    expect(scaleTop([10, 30, 40])).toEqual({ top: 40, outlier: null });
    expect(scaleTop([0, 0, 50])).toEqual({ top: 50, outlier: null });
    expect(scaleTop([])).toEqual({ top: 0, outlier: null });
  });

  it('should cap the scale when the top value is more than four times the next', () => {
    expect(scaleTop([10, 1000, 20])).toEqual({ top: 25, outlier: 1 });
    expect(scaleTop([10, 40])).toEqual({ top: 40, outlier: null });
  });

  it('should keep the other days visible in a mini graph with one huge day', () => {
    const bars = sparkBars([0, 1000, 20, 10], 120, 53)!;
    expect(bars[0]!.y).toBe(3); // the huge day runs to the top edge
    expect(bars[1]!.height).toBe(40); // the 20 keeps its height instead of hugging the floor
  });
});

describe('changeDirection', () => {
  it('should say which way the figure moved', () => {
    expect(changeDirection(0.12)).toBe('up');
    expect(changeDirection(-0.3)).toBe('down');
    expect(changeDirection(0)).toBe('flat');
    expect(changeDirection(null)).toBeNull();
  });
});
