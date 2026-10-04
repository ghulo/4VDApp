import { Package } from '@phosphor-icons/react';
import { useState } from 'react';
import { mediaSrc } from '../services/apiClient';

interface ProductPhotoProps {
  /** The product's imageUrl (an uploaded picture or an outside link), or a local preview. */
  src: string | null;
  size?: 'sm' | 'lg';
}

/** A product's photo, square, with a box drawing when there is none or it fails to load. */
export function ProductPhoto({ src, size = 'sm' }: ProductPhotoProps) {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const url = src && src !== brokenSrc ? (src.startsWith('blob:') ? src : mediaSrc(src)) : null;
  return (
    <span className={`product-photo product-photo--${size}`}>
      {url ? (
        // The product's name always sits next to it, so the picture itself needs no text.
        <img src={url} alt="" width={size === 'lg' ? 112 : 40} height={size === 'lg' ? 112 : 40} loading="lazy" decoding="async" onError={() => setBrokenSrc(src)} />
      ) : (
        <Package size={size === 'lg' ? 32 : 18} aria-hidden="true" />
      )}
    </span>
  );
}
