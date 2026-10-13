import { describe, expect, it } from 'vitest';
import { projectMomentum, rubberband, settleTime, shouldDismiss } from './useSwipeToDismiss';

describe('swipe to dismiss', () => {
  it('projects a flick forward like scroll deceleration', () => {
    expect(projectMomentum(0)).toBe(0);
    expect(projectMomentum(1000)).toBeCloseTo(499, 0);
    expect(projectMomentum(-1000)).toBeCloseTo(-499, 0);
  });

  it('resists more the further past the edge, and never runs away', () => {
    const small = rubberband(20, 400);
    const big = rubberband(400, 400);
    expect(small).toBeLessThan(20);
    expect(big).toBeLessThan(400 * 0.55);
    expect(big / 400).toBeLessThan(small / 20);
  });

  it('a fast flick decides by direction, a slow release by where it would land', () => {
    expect(shouldDismiss(10, 800, 400)).toBe(true);
    expect(shouldDismiss(350, -800, 400)).toBe(false);
    expect(shouldDismiss(250, 0, 400)).toBe(true);
    expect(shouldDismiss(150, 0, 400)).toBe(false);
    expect(shouldDismiss(150, 200, 400)).toBe(true);
  });

  it('settles quicker after a faster flick, within bounds', () => {
    expect(settleTime(200, 3000)).toBeLessThan(settleTime(200, 1000));
    expect(settleTime(200, 100000)).toBe(160);
    expect(settleTime(200, 0)).toBe(450);
  });
});
