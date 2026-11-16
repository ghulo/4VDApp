import { useT } from '../i18n/useT';

type StockLevel = 'out' | 'low' | 'ok';

function stockLevel(quantity: number, reorderLevel: number): StockLevel {
  if (quantity === 0) return 'out';
  if (quantity <= reorderLevel) return 'low';
  return 'ok';
}

interface StockTagProps {
  quantity: number;
  reorderLevel: number;
  size?: 'regular' | 'large';
}

/**
 * Stock count over the app's progress bar (the same inset track as sales
 * against a target), filled to how far stock is above the reorder level: full
 * at four times the reorder level, coloured by whether stock is fine, low or out.
 */
export function StockTag({ quantity, reorderLevel, size = 'regular' }: StockTagProps) {
  const t = useT();
  const level = stockLevel(quantity, reorderLevel);
  const label = t.stockTag[level];
  // Four bays, each one reorder level deep, so the first bay is the alert zone.
  const bay = Math.max(reorderLevel, 1);

  return (
    <span className={`stock-tag stock-tag--${level} stock-tag--${size}`} title={t.stockTag.title(label, reorderLevel)}>
      <span className="stock-tag__count">{quantity}</span>
      <span className="stock-tag__bays" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className="stock-tag__bay">
            <span className="stock-tag__fill" style={{ inlineSize: `${Math.min(Math.max(quantity / bay - index, 0), 1) * 100}%` }} />
          </span>
        ))}
      </span>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
