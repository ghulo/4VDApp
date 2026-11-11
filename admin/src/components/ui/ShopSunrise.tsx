import { LOGO_HOUSE, LOGO_TILE, LOGO_VIEWBOX } from '../logoPaths';

/** The 4VD mark drawn large: the hand-drawn family home on its soft amber tile, settling in once. */
export function ShopSunrise() {
  return (
    <svg className="shop-sunrise" viewBox="0 0 240 140" aria-hidden="true" focusable="false">
      <g className="shop-sunrise__rise">
        <svg x="68" y="14" width="104" height="104" viewBox={LOGO_VIEWBOX}>
          <path className="shop-sunrise__tile" d={LOGO_TILE} fill="#F5B71A" />
          <path className="shop-sunrise__house" d={LOGO_HOUSE} fill="#141413" fillRule="evenodd" />
        </svg>
      </g>
    </svg>
  );
}
