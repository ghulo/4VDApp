import { useId } from 'react';

/**
 * The 4VD mark drawn large, the way iOS 26 draws its icons: a calm amber tile
 * that turns a little see-through towards its foot, and the tick as frosted
 * glass on it, white with the amber faintly showing through, floating on a
 * very soft shadow. No glow, no lit rim.
 */
export function ShopSunrise() {
  // Every drawing on a page needs its own ids.
  const id = useId().replace(/:/g, '');
  const ids = {
    face: `glass-face-${id}`,
    frost: `glass-frost-${id}`,
    near: `glass-near-${id}`,
  };
  const tick = 'M98 66.5 L112.5 84 L142.5 46';
  return (
    <svg className="shop-sunrise" viewBox="0 0 240 140" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={ids.face} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="shop-sunrise__face-top" />
          <stop offset="1" className="shop-sunrise__face-foot" />
        </linearGradient>
        {/* Frosted glass: a little clearer at the foot, so the amber shows through. */}
        <linearGradient id={ids.frost} gradientUnits="userSpaceOnUse" x1="0" y1="40" x2="0" y2="92">
          <stop offset="0" className="shop-sunrise__frost-top" />
          <stop offset="1" className="shop-sunrise__frost-foot" />
        </linearGradient>
        <filter id={ids.near} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      <g className="shop-sunrise__rise">
        <rect className="shop-sunrise__tile" x="72" y="18" width="96" height="96" rx="27" fill={`url(#${ids.face})`} />
        <path className="shop-sunrise__tick-shadow" d={tick} transform="translate(0 3)" filter={`url(#${ids.near})`} />
        <path className="shop-sunrise__tick" d={tick} stroke={`url(#${ids.frost})`} />
      </g>
    </svg>
  );
}
