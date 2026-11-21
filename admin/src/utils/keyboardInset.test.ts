import { describe, expect, it } from 'vitest';
import { keyboardState } from './keyboardInset';

const base = { layout: 800, tallest: 800, visibleHeight: 800, visibleTop: 0, scale: 1, editing: false, touch: true };

describe('keyboardState', () => {
  it('sees no keyboard on a page at full height', () => {
    expect(keyboardState(base)).toEqual({ covered: 0, open: false });
  });

  it('measures an iPhone keyboard laid over the page', () => {
    expect(keyboardState({ ...base, visibleHeight: 460, editing: true })).toEqual({ covered: 340, open: true });
  });

  it('allows for the visible part being scrolled down', () => {
    expect(keyboardState({ ...base, visibleHeight: 460, visibleTop: 100, editing: true })).toEqual({ covered: 240, open: true });
  });

  it('sees an Android keyboard by the page getting shorter while typing', () => {
    expect(keyboardState({ ...base, layout: 480, visibleHeight: 480, editing: true })).toEqual({ covered: 0, open: true });
  });

  it('ignores a shorter page without a field in focus (a resized window)', () => {
    expect(keyboardState({ ...base, layout: 480, visibleHeight: 480 })).toEqual({ covered: 0, open: false });
  });

  it('ignores a shorter window on a PC, field in focus or not', () => {
    expect(keyboardState({ ...base, layout: 480, visibleHeight: 480, editing: true, touch: false })).toEqual({ covered: 0, open: false });
  });

  it('ignores the address bar and pinch zoom', () => {
    expect(keyboardState({ ...base, visibleHeight: 740, editing: true })).toEqual({ covered: 0, open: false });
    expect(keyboardState({ ...base, visibleHeight: 400, scale: 2 })).toEqual({ covered: 0, open: false });
  });
});
