/*
 * The till's two sounds, made with Web Audio so there are no sound files:
 * a short high beep when a scan adds a product, a low double buzz when it
 * doesn't. Both are kept quiet: a shop, not an arcade.
 */

type Tone = { frequency: number; type: OscillatorType; seconds: number; gain: number; gap?: number; repeat?: number };

const TONES: Record<'ok' | 'fail', Tone> = {
  ok: { frequency: 1760, type: 'sine', seconds: 0.07, gain: 0.08 },
  fail: { frequency: 180, type: 'square', seconds: 0.14, gain: 0.05, gap: 0.06, repeat: 2 },
};

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (context) return context;
  const scope = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Context = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Context) return null;
  try {
    context = new Context();
  } catch {
    return null;
  }
  return context;
}

/** Play the "added" beep or the "didn't work" buzz; silent where the browser has no Web Audio. */
export function playScanSound(kind: 'ok' | 'fail'): void {
  const ctx = audio();
  if (!ctx) return;
  // The scanner's keys count as a gesture, so a suspended context can resume.
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  const tone = TONES[kind];
  const start = ctx.currentTime + 0.005;
  for (let index = 0; index < (tone.repeat ?? 1); index++) {
    const at = start + index * (tone.seconds + (tone.gap ?? 0));
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = tone.type;
    oscillator.frequency.setValueAtTime(tone.frequency, at);
    // A soft start and end, so it never clicks.
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(tone.gain, at + 0.008);
    gain.gain.setValueAtTime(tone.gain, at + tone.seconds - 0.02);
    gain.gain.linearRampToValueAtTime(0, at + tone.seconds);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(at);
    oscillator.stop(at + tone.seconds + 0.01);
  }
}

/** For tests: forget the audio context so the next sound makes a new one. */
export function resetScanSound(): void {
  context = null;
}
