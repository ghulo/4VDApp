import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeElement {
  readonly typing: boolean;
  constructor(typing: boolean) {
    this.typing = typing;
  }
  isContentEditable = false;
  matches = () => this.typing;
}

/** A fresh module each time: "keys seen" is remembered per page load. */
async function load(media: Record<string, boolean>, shortSide: number) {
  vi.resetModules();
  let onKey: (event: { target: unknown }) => void = () => undefined;
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({ matches: media[query] ?? false }),
    screen: { width: shortSide, height: 800 },
    addEventListener: (_type: string, listener: typeof onKey) => {
      onKey = listener;
    },
  });
  const { touchPhone } = await import('./touchPhone');
  return { touchPhone, key: (typing: boolean) => onKey({ target: new FakeElement(typing) }) };
}

const finger = { '(pointer: coarse)': true, '(any-pointer: fine)': false };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('touchPhone', () => {
  it('is a phone held by touch alone', async () => {
    expect((await load(finger, 390)).touchPhone()).toBe(true);
  });

  it('is not a PC, a touch laptop with a trackpad, or a wide touch till', async () => {
    expect((await load({}, 390)).touchPhone()).toBe(false);
    expect((await load({ ...finger, '(any-pointer: fine)': true }, 390)).touchPhone()).toBe(false);
    expect((await load(finger, 1080)).touchPhone()).toBe(false);
  });

  it('stops counting as one once a key comes from outside a text field (a scanner or keyboard)', async () => {
    const { touchPhone, key } = await load(finger, 390);
    key(true);
    expect(touchPhone()).toBe(true);
    key(false);
    expect(touchPhone()).toBe(false);
  });
});
