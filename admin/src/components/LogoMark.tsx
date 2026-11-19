import { useId } from 'react';
import { LOGO_HOUSE, LOGO_TILE, LOGO_VIEWBOX } from './logoPaths';

/**
 * The 4VD logo: the hand-drawn family home on its tile (see brand/logo-mark.svg),
 * on its own, no letters. The tile takes the business's main colour (running to
 * its accent when the gradient is on) and the house the ink that reads on it, so
 * on 4VD's own colours it is the amber tile it has always been. A wrapper can set
 * --logo-from, --logo-to and --logo-ink to draw it in other colours (the previews).
 * Hidden from screen readers: give its link a label.
 */
export function LogoMark({ size = 46 }: { size?: number }) {
  const tile = `logo-tile-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  return (
    <svg className="logo-mark" width={size} height={size} viewBox={LOGO_VIEWBOX} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={tile} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--logo-from, var(--cta, #F5B71A))' }} />
          <stop offset="1" style={{ stopColor: 'var(--logo-to, var(--mark-to, var(--logo-from, var(--cta, #F5B71A))))' }} />
        </linearGradient>
      </defs>
      <path d={LOGO_TILE} fill={`url(#${tile})`} />
      <path d={LOGO_HOUSE} style={{ fill: 'var(--logo-ink, var(--mark-ink, var(--cta-ink, #141413)))' }} fillRule="evenodd" />
    </svg>
  );
}
