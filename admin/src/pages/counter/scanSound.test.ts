import { afterEach, describe, expect, it, vi } from 'vitest';
import { playScanSound, resetScanSound } from './scanSound';

function fakeAudio() {
  const oscillators: Array<{ type: string; hz: number }> = [];
  class FakeContext {
    state = 'running';
    currentTime = 0;
    destination = {};
    resume = vi.fn(() => Promise.resolve());
    createOscillator() {
      const oscillator = {
        type: 'sine',
        hz: 0,
        frequency: { setValueAtTime: (value: number) => (oscillator.hz = value) },
        connect: (node: unknown) => node,
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(oscillator);
      return oscillator;
    }
    createGain() {
      return { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: (node: unknown) => node };
    }
  }
  vi.stubGlobal('AudioContext', FakeContext);
  return oscillators;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetScanSound();
});

describe('scan sounds', () => {
  it('beeps once, high, when a scan adds a product', () => {
    const played = fakeAudio();
    playScanSound('ok');
    expect(played).toHaveLength(1);
    expect(played[0]!.hz).toBeGreaterThan(1000);
  });

  it('buzzes twice, low, when a scan fails', () => {
    const played = fakeAudio();
    playScanSound('fail');
    expect(played).toHaveLength(2);
    expect(played.every((tone) => tone.hz < 400)).toBe(true);
  });

  it('stays silent where there is no Web Audio', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => playScanSound('ok')).not.toThrow();
  });
});
