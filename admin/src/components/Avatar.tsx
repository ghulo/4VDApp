import { mediaSrc } from '../services/apiClient';

// Muted tones that keep white initials readable in both themes.
const COLOURS = ['#c2410c', '#9a3412', '#1e40af', '#6d28d9', '#047857', '#57534e'];

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

/** A person's photo, or their initials when they haven't added one. */
export function Avatar({ name, url, size = 36 }: { name: string; url: string | null; size?: number }) {
  const src = mediaSrc(url);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  return src ? (
    <img className="avatar" src={src} alt="" width={size} height={size} style={style} />
  ) : (
    <span className="avatar avatar--initials" style={{ ...style, background: colourFor(name) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
