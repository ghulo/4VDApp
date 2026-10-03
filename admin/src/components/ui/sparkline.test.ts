import { describe, expect, it } from 'vitest';
import { changeDirection, sparklinePaths } from './sparkline';

describe('sparklinePaths', () => {
  it('should draw nothing when there is no data', () => {
    expect(sparklinePaths([])).toBeNull();
    expect(sparklinePaths([0, 0, 0])).toBeNull();
  });

  it('should run from the left edge to the right edge, highest point at the top', () => {
    const paths = sparklinePaths([0, 10, 5], 100, 50)!;
    expect(paths.line).toBe('M0,50 L50,3 L100,26.5');
    expect(paths.area).toBe('M0,50 L50,3 L100,26.5 L100,50 L0,50 Z');
  });

  it('should draw a single point as a flat line', () => {
    expect(sparklinePaths([7], 100, 50)!.line).toBe('M0,3 L100,3');
  });

  it('should keep negative days (refunds) below the zero line', () => {
    const { line } = sparklinePaths([-10, 10], 100, 50)!;
    expect(line).toBe('M0,50 L100,3');
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
