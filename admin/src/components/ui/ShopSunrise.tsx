import { useId } from 'react';

/**
 * The 4VD mark drawn large and set into the wall: a recess cut into the page, and
 * inside it the amber glass tile with the tick engraved in it. Light comes from
 * above, so the recess is shadowed at the top and lit along its bottom lip.
 */
export function ShopSunrise() {
  // Every drawing on a page needs its own ids.
  const id = useId().replace(/:/g, '');
  const recessId = `recess-${id}`;
  const rimId = `recess-rim-${id}`;
  const glassId = `tile-glass-${id}`;
  const glossId = `tile-gloss-${id}`;
  const blurId = `soft-${id}`;
  return (
    <svg className="shop-sunrise" viewBox="0 0 240 140" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={recessId}>
          <rect x="66" y="16" width="108" height="108" rx="27" />
        </clipPath>
        {/* The recess edge: in shadow at the top, catching the light at the bottom. */}
        <linearGradient id={rimId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="shop-sunrise__rim-dark" />
          <stop offset="1" className="shop-sunrise__rim-light" />
        </linearGradient>
        {/* Amber glass, lit from above with a deeper foot. */}
        <linearGradient id={glassId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="shop-sunrise__glass-top" />
          <stop offset="0.55" className="shop-sunrise__glass-base" />
          <stop offset="1" className="shop-sunrise__glass-foot" />
        </linearGradient>
        <linearGradient id={glossId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="shop-sunrise__gloss-top" />
          <stop offset="1" className="shop-sunrise__gloss-end" />
        </linearGradient>
        <filter id={blurId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3.5" />
        </filter>
      </defs>

      {/* The hole in the wall. */}
      <rect className="shop-sunrise__recess" x="66" y="16" width="108" height="108" rx="27" />
      <g clipPath={`url(#${recessId})`}>
        {/* The wall's own shadow falling into the top of the hole. */}
        <rect
          className="shop-sunrise__shade"
          x="66"
          y="16"
          width="108"
          height="108"
          rx="27"
          strokeWidth="12"
          transform="translate(0 5)"
          filter={`url(#${blurId})`}
        />
        <g className="shop-sunrise__rise">
          {/* The tile's shadow on the back of the recess. */}
          <rect className="shop-sunrise__drop" x="74" y="29" width="92" height="92" rx="21" filter={`url(#${blurId})`} />
          <rect className="shop-sunrise__tile" x="74.5" y="24.5" width="91" height="91" rx="20.5" fill={`url(#${glassId})`} />
          {/* Glass: a soft sheen over the top half and a bright line along the top edge. */}
          <path
            d="M95 26 H145 A19 19 0 0 1 164 45 V60 C140 66 100 66 76 58 V45 A19 19 0 0 1 95 26 Z"
            fill={`url(#${glossId})`}
          />
          <path className="shop-sunrise__glint" d="M90 26.5 H150" />
          {/* The tick, engraved: a lit lip below the cut, then the ink. */}
          <path className="shop-sunrise__tick-lip" d="M98.4 72.9 L112.8 90.2 L141.6 51.4" />
          <path className="shop-sunrise__tick" d="M98.4 71.4 L112.8 88.7 L141.6 49.9" />
        </g>
      </g>
      <rect className="shop-sunrise__rim" x="66.5" y="16.5" width="107" height="107" rx="26.5" stroke={`url(#${rimId})`} />
    </svg>
  );
}
