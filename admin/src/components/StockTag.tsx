type StockLevel = 'out' | 'low' | 'ok';

function stockLevel(quantity: number, reorderLevel: number): StockLevel {
  if (quantity === 0) return 'out';
  if (quantity <= reorderLevel) return 'low';
  return 'ok';
}

const LEVEL_LABEL: Record<StockLevel, string> = {
  out: 'Out of stock',
  low: 'Low stock',
  ok: 'In stock',
};

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
  const level = stockLevel(quantity, reorderLevel);
  const fullAt = Math.max(reorderLevel * 2, 1);
  const fill = Math.min(quantity / fullAt, 1);

  return (
    <span className={`stock-tag stock-tag--${level} stock-tag--${size}`} title={`${LEVEL_LABEL[level]}, reorder at ${reorderLevel}`}>
      <span className="stock-tag__count">{quantity}</span>
      <span className="stock-tag__gauge" aria-hidden="true">
        <span className="stock-tag__fill" style={{ width: `${fill * 100}%` }} />
        <span className="stock-tag__reorder-mark" />
      </span>
      <span className="visually-hidden">{LEVEL_LABEL[level]}</span>
    </span>
  );
}
