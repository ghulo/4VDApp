import { mediaSrc } from '../services/apiClient';

// Warm ink, stone, ember, clay and two greens: from the palette's family, all
// dark enough for white initials (5:1 or more). Keep both apps' lists the same.
const COLOURS = ['#1f1b19', '#57534e', '#9a3412', '#7c5a3c', '#047857', '#3f6212'];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() || '?';
}

/** Same name, same colour, every time. */
function colourFor(name: string): string {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return COLOURS[hash % COLOURS.length]!;
}

/** Initials use the type scale (DESIGN.md): the step nearest 40% of the circle, never under 12px. */
const INITIAL_SIZES = [12, 13, 15, 17, 28];
const initialSize = (size: number) =>
  INITIAL_SIZES.reduce((best, step) => (Math.abs(step - size * 0.4) < Math.abs(best - size * 0.4) ? step : best));

/**
 * A person's photo, or their initials when they haven't added one. The initials are
 * drawn by CSS: the name around the avatar is what gets read out, and a link labelled
 * "Your profile" must not show letters missing from that label.
 */
export function Avatar({ name, url, size = 36 }: { name: string; url: string | null; size?: number }) {
  const src = mediaSrc(url);
  const style = { width: size, height: size, fontSize: initialSize(size) };
  return src ? (
    <img className="avatar" src={src} alt="" width={size} height={size} style={style} />
  ) : (
    <span className="avatar avatar--initials" style={{ ...style, background: colourFor(name) }} data-initials={initials(name)} aria-hidden="true" />
  );
}
