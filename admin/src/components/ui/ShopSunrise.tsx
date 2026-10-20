import { useId } from 'react';

/**
 * The 4VD mark drawn large, the way iOS 26 draws its icons: an amber glass
 * tile (clear and light in the middle, thicker and richer at its edges, a
 * faint frost and a hairline rim), and the tick as frosted glass on it, white
 * with the amber faintly showing through, resting on two soft shadows.
 */
export function ShopSunrise() {
  // Every drawing on a page needs its own ids.
  const id = useId().replace(/:/g, '');
  const ids = {
    face: `glass-face-${id}`,
    clip: `glass-clip-${id}`,
    edge: `glass-edge-${id}`,
    frostGlow: `glass-frostglow-${id}`,
    rim: `glass-rim-${id}`,
    frost: `glass-frost-${id}`,
    near: `glass-near-${id}`,
    contact: `glass-contact-${id}`,
  };
  const tick = 'M98 66.5 L112.5 84 L142.5 46';
  return (
    <svg className="shop-sunrise" viewBox="0 0 240 140" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={ids.clip}>
          <rect x="72" y="18" width="96" height="96" rx="27" />
        </clipPath>
        {/* Glass: clear and light in the middle, richer where it is thick at the edge. */}
        <radialGradient id={ids.face} cx="0.5" cy="0.42" r="0.72">
          <stop offset="0" className="shop-sunrise__face-top" />
          <stop offset="1" className="shop-sunrise__face-foot" />
        </radialGradient>
        <radialGradient id={ids.frostGlow} cx="0.3" cy="0.15" r="0.6">
          <stop offset="0" className="shop-sunrise__sheen-on" />
          <stop offset="1" className="shop-sunrise__sheen-off" />
        </radialGradient>
        <linearGradient id={ids.rim} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="shop-sunrise__rim-top" />
          <stop offset="0.5" className="shop-sunrise__rim-mid" />
          <stop offset="1" className="shop-sunrise__rim-foot" />
        </linearGradient>
        <filter id={ids.edge} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
        {/* Frosted glass: a little clearer at the foot, so the amber shows through. */}
        <linearGradient id={ids.frost} gradientUnits="userSpaceOnUse" x1="0" y1="40" x2="0" y2="92">
          <stop offset="0" className="shop-sunrise__frost-top" />
          <stop offset="1" className="shop-sunrise__frost-foot" />
        </linearGradient>
        <filter id={ids.near} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="4.5" />
        </filter>
        <filter id={ids.contact} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
      </defs>

      <g className="shop-sunrise__rise">
        <rect className="shop-sunrise__tile" x="72" y="18" width="96" height="96" rx="27" fill={`url(#${ids.face})`} />
        <g clipPath={`url(#${ids.clip})`}>
          {/* The glass's thickness, seen at its edge. */}
          <rect className="shop-sunrise__edge" x="72" y="18" width="96" height="96" rx="27" filter={`url(#${ids.edge})`} />
          <rect x="72" y="18" width="96" height="96" fill={`url(#${ids.frostGlow})`} />
        </g>
        <rect className="shop-sunrise__rim" x="72.5" y="18.5" width="95" height="95" rx="26.5" stroke={`url(#${ids.rim})`} />
        {/* Two shadows, the way light really falls: a wide soft one it casts,
            and a tight dark one hugging its edge where it meets the tile. */}
        <path className="shop-sunrise__tick-shadow" d={tick} transform="translate(0 5)" filter={`url(#${ids.near})`} />
        <path className="shop-sunrise__tick-contact" d={tick} transform="translate(0 1.2)" filter={`url(#${ids.contact})`} />
        <path className="shop-sunrise__tick" d={tick} stroke={`url(#${ids.frost})`} />
      </g>
    </svg>
  );
}
