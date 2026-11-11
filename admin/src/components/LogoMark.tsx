import { LOGO_HOUSE, LOGO_TILE, LOGO_VIEWBOX } from './logoPaths';

/**
 * The 4VD logo: the hand-drawn family home on its soft amber tile (see brand/logo-mark.svg),
 * on its own, no letters. Same on light and dark. Hidden from screen readers: give its link a label.
 */
export function LogoMark({ size = 46 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox={LOGO_VIEWBOX} aria-hidden="true" focusable="false">
      <path d={LOGO_TILE} fill="#F5B71A" />
      <path d={LOGO_HOUSE} fill="#141413" fillRule="evenodd" />
    </svg>
  );
}
