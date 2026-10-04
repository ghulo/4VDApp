import { useId } from 'react';

/** The 4VD mark's four equal pillars, spread across the shop front. */
const PILLARS = [84, 104.33, 124.67, 145];

/**
 * The shop at sunrise, in the logo's shapes: one roof, four equal pillars, a
 * clay sun rising behind them with printed-sunset stripes. Ink follows the
 * theme, so the shop is dark on paper and ivory at night.
 */
export function ShopSunrise() {
  // Every drawing on a page needs its own mask id.
  const id = useId().replace(/:/g, '');
  const maskId = `sun-stripes-${id}`;
  const clipId = `above-ground-${id}`;
  return (
    <svg className="shop-sunrise" viewBox="0 0 240 140" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clipId}>
          <rect width="240" height="120" />
        </clipPath>
        <mask id={maskId}>
          <rect width="240" height="140" fill="#fff" />
          {/* Gaps that widen toward the ground, like a printed sunset. */}
          <rect x="0" y="86" width="240" height="2" fill="#000" />
          <rect x="0" y="94" width="240" height="3" fill="#000" />
          <rect x="0" y="103" width="240" height="4" fill="#000" />
          <rect x="0" y="112" width="240" height="5" fill="#000" />
        </mask>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <g className="shop-sunrise__rise">
          <circle className="shop-sunrise__glow" cx="120" cy="96" r="74" />
          <circle className="shop-sunrise__sun" cx="120" cy="96" r="54" mask={`url(#${maskId})`} />
        </g>
      </g>
      <path className="shop-sunrise__roof" d="M76 70 L120 42 L164 70" />
      {PILLARS.map((x) => (
        <rect key={x} className="shop-sunrise__shop" x={x} y="76" width="11" height="38" rx="2" />
      ))}
      <rect className="shop-sunrise__shop" x="74" y="113" width="92" height="7" rx="2" />
      <rect className="shop-sunrise__shop" x="6" y="120" width="228" height="3" rx="1.5" />
      <rect className="shop-sunrise__horizon" x="40" y="128" width="160" height="2" rx="1" />
      <rect className="shop-sunrise__horizon shop-sunrise__horizon--far" x="76" y="134" width="88" height="2" rx="1" />
    </svg>
  );
}
