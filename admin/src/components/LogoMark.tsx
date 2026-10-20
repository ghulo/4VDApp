/** The 4VD mark: an ink tick on a solid amber tile (see brand/logo-mark.svg). Same on light and dark. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="#F5B71A" />
      <path d="M17 33 L27 45 L47 18" fill="none" stroke="#141413" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The 4VD wordmark: an open 4, the V drawn as a tick, a D (see brand/logo-full.svg).
 * The letters take the text colour and the tick the theme's amber, so it follows light and dark.
 * `height` sets the size; the width follows. Hidden from screen readers: give its link a label.
 */
export function Wordmark({ height = 22 }: { height?: number }) {
  return (
    <svg className="wordmark" height={height} width={Math.round((height * 213) / 89)} viewBox="28 4 213 89" aria-hidden="true" focusable="false">
      <g fill="none" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round">
        <path d="M58 15 L36 64 H88 M72 38 V85 M186 15 V85 H204 C242 85 242 15 204 15 Z" stroke="currentColor" />
        <path d="M106 54 L125 83 L165 12" stroke="var(--logo-tick)" />
      </g>
    </svg>
  );
}
