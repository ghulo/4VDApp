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
 * Stock count styled like a shelf tag, over a gauge of how far stock is above
 * the reorder level: full at twice the reorder level, so the reorder point sits
 * halfway. In lists it's a row of printed blocks with a wider gap at that point;
 * large (a product's own page) it's one slim track with a tick there.
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
      {size === 'large' ? (
        <span className="stock-tag__track" aria-hidden="true">
          <span className="stock-tag__fill" style={{ width: `${Math.min(quantity / fullAt, 1) * 100}%` }} />
          <span className="stock-tag__mark" />
        </span>
      ) : (
        <span className="stock-tag__gauge" aria-hidden="true">
          {Array.from({ length: BLOCKS }, (_, index) => (
            <span key={index} className={index < lit ? 'stock-tag__block stock-tag__block--lit' : 'stock-tag__block'} />
          ))}
        </span>
      )}
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
