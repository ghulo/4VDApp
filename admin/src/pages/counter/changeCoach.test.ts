import { describe, expect, it } from 'vitest';
import { changeIn, likelyNotes } from './changeCoach';

describe('the change coach', () => {
  it('gives change back in the fewest notes and coins', () => {
    expect(changeIn(12.85)).toEqual([
      { value: 10, count: 1 },
      { value: 2, count: 1 },
      { value: 0.5, count: 1 },
      { value: 0.2, count: 1 },
      { value: 0.1, count: 1 },
      { value: 0.05, count: 1 },
    ]);
    expect(changeIn(0.3)).toEqual([
      { value: 0.2, count: 1 },
      { value: 0.1, count: 1 },
    ]);
    expect(changeIn(0)).toEqual([]);
  });

  it('suggests the notes a customer will likely hand over', () => {
    expect(likelyNotes(7.4)).toEqual([8, 10, 20, 50]);
    expect(likelyNotes(20)).toEqual([50, 100]);
  });
});
