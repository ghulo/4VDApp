import { describe, expect, it } from 'vitest';
import {
  checkSteps,
  DEFAULT_SHORT_DATED,
  shortDatedPercent,
  shortDatedPrice,
  shortDatedWindow,
} from '../src/services/pricing/shortDated.js';

const steps = DEFAULT_SHORT_DATED.steps;

describe('short-dated discount maths', () => {
  it('should grow the discount as the date nears, deepest on the day itself', () => {
    expect([4, 3, 2, 1, 0].map((days) => shortDatedPercent(days, 3, steps))).toEqual([null, 20, 30, 50, 50]);
  });

  it('should give nothing once the date has passed', () => {
    expect(shortDatedPercent(-1, 3, steps)).toBeNull();
  });

  it('should give the first step to days inside a longer window', () => {
    expect([7, 5, 4].map((days) => shortDatedPercent(days, 7, steps))).toEqual([20, 20, 20]);
  });

  it('should take the product’s window, else its category’s, else the shop’s', () => {
    expect(shortDatedWindow(5, 2, DEFAULT_SHORT_DATED)).toBe(5);
    expect(shortDatedWindow(null, 2, DEFAULT_SHORT_DATED)).toBe(2);
    expect(shortDatedWindow(null, null, DEFAULT_SHORT_DATED)).toBe(3);
  });

  it('should take the percent off the shelf price', () => {
    expect(shortDatedPrice(2, 30, 1, false)).toEqual({ price: 1.4, percent: 30 });
  });

  it('should stop at cost unless the shop allows going below it', () => {
    expect(shortDatedPrice(2, 50, 1.5, false)).toEqual({ price: 1.5, percent: 25 });
    expect(shortDatedPrice(2, 50, 1.5, true)).toEqual({ price: 1, percent: 50 });
  });

  it('should give no discount when the cost is above the shelf price', () => {
    expect(shortDatedPrice(2, 30, 2.5, false)).toEqual({ price: 2, percent: 0 });
  });

  it('should cap the discount at 30% when the cost is unknown', () => {
    expect(shortDatedPrice(2, 50, null, false)).toEqual({ price: 1.4, percent: 30 });
    expect(shortDatedPrice(2, 50, null, true)).toEqual({ price: 1, percent: 50 });
  });

  it('should sort the steps and refuse ones that make no sense', () => {
    expect(checkSteps([{ days: 1, percent: 50 }, { days: 3, percent: 20 }]).map((step) => step.days)).toEqual([3, 1]);
    expect(() => checkSteps([])).toThrow();
    expect(() => checkSteps([{ days: 2, percent: 20 }, { days: 2, percent: 30 }])).toThrow();
    expect(() => checkSteps([{ days: 3, percent: 40 }, { days: 1, percent: 20 }])).toThrow();
    expect(() => checkSteps([{ days: 1, percent: 95 }])).toThrow();
  });
});
