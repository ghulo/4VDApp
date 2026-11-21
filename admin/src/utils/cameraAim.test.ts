import { describe, expect, it } from 'vitest';
import { aimArea } from './cameraAim';

describe('aimArea', () => {
  it('takes the aim box out of a picture shown whole', () => {
    expect(aimArea({ width: 1000, height: 500 }, { width: 400, height: 200 })).toEqual({ x: 80, y: 110, width: 840, height: 280 });
  });

  it('allows for the sides cut off a wide frame in a tall box', () => {
    // A 1280×720 frame in a 343×320 box: only the middle 772px of the width is on screen.
    const area = aimArea({ width: 1280, height: 720 }, { width: 343, height: 320 });
    expect(area.height).toBe(Math.round(720 * 0.56));
    expect(area.width).toBe(Math.round(720 * (343 / 320) * 0.84));
    expect(area.x).toBe(Math.round((1280 - area.width) / 2));
  });

  it('allows for the top and bottom cut off a tall frame in a wide box', () => {
    const area = aimArea({ width: 720, height: 1280 }, { width: 343, height: 320 });
    expect(area.width).toBe(Math.round(720 * 0.84));
    expect(area.y).toBe(Math.round((1280 - area.height) / 2));
  });
});
