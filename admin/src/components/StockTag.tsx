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
  // Full at four times the reorder level, so the alert point sits a quarter of the way along.
  const fullAt = Math.max(reorderLevel * 4, 1);

  return (
    <span className={`stock-tag stock-tag--${level} stock-tag--${size}`} title={t.stockTag.title(label, reorderLevel)}>
      <span className="stock-tag__count">{quantity}</span>
      <span className="target-bar__track" aria-hidden="true">
        <span className="target-bar__fill" style={{ inlineSize: `${Math.min(quantity / fullAt, 1) * 100}%` }} />
      </span>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
