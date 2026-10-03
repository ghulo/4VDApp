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
 * Stock count styled like a shelf tag. The bar shows how far stock is above
 * the reorder level: it fills up at twice the reorder level, so "half full"
 * means "you're at the point where you should reorder".
 */
export function StockTag({ quantity, reorderLevel, size = 'regular' }: StockTagProps) {
  const t = useT();
  const level = stockLevel(quantity, reorderLevel);
  const label = t.stockTag[level];
  const fullAt = Math.max(reorderLevel * 2, 1);
  const fill = Math.min(quantity / fullAt, 1);

  return (
    <span className={`stock-tag stock-tag--${level} stock-tag--${size}`} title={t.stockTag.title(label, reorderLevel)}>
      <span className="stock-tag__count">{quantity}</span>
      <span className="stock-tag__gauge" aria-hidden="true">
        <span className="stock-tag__fill" style={{ width: `${fill * 100}%` }} />
        <span className="stock-tag__reorder-mark" />
      </span>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
