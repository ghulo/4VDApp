import { useQuery } from '@tanstack/react-query';
import { useT } from '../i18n/useT';
import { serialsApi } from '../services/api';
import { useFeatures } from '../utils/useFeatures';
import { SerialEntry } from './SerialEntry';
import { Card } from './ui';

interface IntakeLine {
  productId: number | null;
  productName: string | null;
  quantity: number;
}

/**
 * On a bill or a stock-in: for each line whose product has serial numbers,
 * a place to scan them as the goods are unpacked. Shows nothing while Serial
 * numbers is off or no line needs one.
 */
export function SerialIntakeCard({ lines, billId, stockDocumentId }: { lines: IntakeLine[]; billId?: number; stockDocumentId?: number }) {
  const t = useT();
  const { serials: on } = useFeatures();
  const products = useQuery({ queryKey: ['serials', 'products'], queryFn: serialsApi.products, enabled: on });
  if (!on || !products.data) return null;
  const tracked = new Set(products.data.map((product) => product.productId));
  const needing = lines.filter((line): line is IntakeLine & { productId: number } => line.productId !== null && tracked.has(line.productId) && line.quantity > 0);
  if (needing.length === 0) return null;
  return (
    <Card title={t.serials.add} description={t.serials.addHint}>
      {needing.map((line) => (
        <section key={line.productId} className="serial-intake" aria-label={t.serials.forLine(line.productName ?? '')}>
          <h3 className="serial-intake__name">{line.productName}</h3>
          <SerialEntry productId={line.productId} billId={billId} stockDocumentId={stockDocumentId} max={Math.ceil(line.quantity)} />
        </section>
      ))}
    </Card>
  );
}
