import { type CSSProperties, useState } from 'react';
import type { Brand } from '../services/types';
import { mediaSrc } from '../services/apiClient';
import { LogoMark } from './LogoMark';

type MarkBrand = Pick<Brand, 'house' | 'logoUrl' | 'initials'>;

/**
 * The business's own mark: 4VD's family home for 4VD's own business, else the
 * logo its owner uploaded, else its initials on a key in its colour (the key
 * reads --cta, which applyBrand sets to the business's colour). Hidden from
 * screen readers like LogoMark: give its link a label.
 */
export function BrandMark({ brand, size = 36 }: { brand: MarkBrand | null | undefined; size?: number }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (!brand || brand.house) return <LogoMark size={size} />;
  const src = mediaSrc(brand.logoUrl);
  const sized = { '--mark-size': `${size}px` } as CSSProperties;
  if (src && broken !== src) {
    return <img className="brand-mark brand-mark--logo" src={src} alt="" width={size} height={size} style={sized} onError={() => setBroken(src)} />;
  }
  return (
    // The letters are drawn by CSS (::after), so a link around the mark is named by its label alone.
    <span className="brand-mark brand-mark--initials" style={sized} data-initials={brand.initials} aria-hidden="true" />
  );
}
