import { describe, expect, it } from 'vitest';
import { shopSunrise as teamAppSunrise } from '../../../../mobile/src/components/dither';
import { shopSunrise } from './dither';

describe('shopSunrise', () => {
  it.each([
    [100, 40],
    [240, 40],
  ])('should draw the same %i × %i picture as the team app', (columns, rows) =>
    expect(shopSunrise(columns, rows)).toEqual(teamAppSunrise(columns, rows)));
});
