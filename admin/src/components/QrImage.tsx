import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { scanUrl } from '../utils/scanLinks';

/**
 * A product's QR code, linking to it in the team app. Black on white for the
 * same reason as barcodes: phone cameras read dark modules on a light background.
 */
export function QrImage({ code, size = 96, label }: { code: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    QRCode.toDataURL(scanUrl(code), { margin: 1, width: size * 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then((url) => current && setSrc(url))
      .catch(() => current && setSrc(null));
    return () => {
      current = false;
    };
  }, [code, size]);

  return src ? <img className="qr-image" src={src} width={size} height={size} alt={label} /> : null;
}
