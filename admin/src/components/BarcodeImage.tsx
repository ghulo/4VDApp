import JsBarcode from 'jsbarcode';
import { useEffect, useRef } from 'react';

/** True when `code` is a valid EAN-13, so it can be drawn as one (shorter, and what shop scanners expect). */
function isEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  const sum = [...code.slice(0, 12)].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

interface BarcodeImageProps {
  value: string;
  /** Bar height in pixels; the printed size follows the label. */
  height?: number;
  label: string;
}

/**
 * A barcode drawn as SVG. Always black bars on white, whatever the theme:
 * scanners read only dark bars on a light background, so these two colours
 * are a requirement, not a style choice.
 */
export function BarcodeImage({ value, height = 48, label }: BarcodeImageProps) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, {
        format: isEan13(value) ? 'EAN13' : 'CODE128',
        height,
        width: 1.6,
        margin: 4,
        fontSize: 12,
        background: '#ffffff',
        lineColor: '#000000',
      });
    } catch {
      // A code JsBarcode can't draw just shows as text below.
    }
  }, [value, height]);

  return <svg ref={ref} className="barcode-image" role="img" aria-label={label} />;
}
