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

const BLOCKS = 10;

/**
 * Stock count styled like a shelf tag, over a row of printed blocks showing how
 * far stock is above the reorder level: the row is full at twice the reorder
 * level, and a wider gap after the fifth block marks the reorder point.
 */
export function StockTag({ quantity, reorderLevel, size = 'regular' }: StockTagProps) {
  const t = useT();
  const level = stockLevel(quantity, reorderLevel);
  const label = t.stockTag[level];
  const fullAt = Math.max(reorderLevel * 2, 1);
  const lit = Math.round(Math.min(quantity / fullAt, 1) * BLOCKS);

  return (
    <span className={`stock-tag stock-tag--${level} stock-tag--${size}`} title={t.stockTag.title(label, reorderLevel)}>
      <span className="stock-tag__count">{quantity}</span>
      <span className="stock-tag__gauge" aria-hidden="true">
        {Array.from({ length: BLOCKS }, (_, index) => (
          <span key={index} className={index < lit ? 'stock-tag__block stock-tag__block--lit' : 'stock-tag__block'} />
        ))}
      </span>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
