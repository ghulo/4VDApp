import { describe, expect, it } from 'vitest';
import { PIXEL_ART as TEAM_APP_ART } from '../../../../mobile/src/components/pixelDrawings';
import { PIXEL_ART } from './pixelDrawings';

describe('PIXEL_ART', () => {
  it('should match the team app, so both draw the same pictograms', () => expect(PIXEL_ART).toEqual(TEAM_APP_ART));
});
