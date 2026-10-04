import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router';
import { BarcodeImage } from '../components/BarcodeImage';
import { QrImage } from '../components/QrImage';
import { ErrorNotice, Loading } from '../components/Feedback';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { useT } from '../i18n/useT';
import { productsApi } from '../services/api';
import type { Product } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatMoney } from '../utils/format';
import { Button, Card, Field, PageHeader } from '../components/ui';

type Layout = 'sheet' | 'roll';
const LAYOUTS: Layout[] = ['sheet', 'roll'];
/** Barcodes suit shop scanners; QR codes suit phones (any camera opens the product). */
type Symbols = 'barcode' | 'qr' | 'both';
const SYMBOLS: Symbols[] = ['barcode', 'qr', 'both'];
const MAX_COPIES = 100;

/** Page sizes for printing: an A4 sticker sheet, or one small label at a time on a label printer. */
const PAGE_CSS: Record<Layout, string> = {
  // Standard 70 × 37 mm sheets: 3 × 8 labels fill the whole A4 page, edge to edge.
  sheet: '@page { size: A4; margin: 0; }',
  roll: '@page { size: 50mm 30mm; margin: 0; }',
};

/** Pick products and how many labels of each, then print them with name, price and barcode. */
export function LabelsPage() {
  const t = useT();
  const { role } = useCurrentUser();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const products = useQuery({ queryKey: ['products', 'all-for-labels'], queryFn: () => productsApi.list({ page: 1, limit: 100 }) });
  const [copies, setCopies] = useState<Record<number, number>>(() =>
    Object.fromEntries((params.get('products') ?? '').split(',').filter(Boolean).map((id) => [Number(id), 1])),
  );
  const [layout, setLayout] = useState<Layout>('sheet');
  const [symbols, setSymbols] = useState<Symbols>('barcode');
  const [search, setSearch] = useState('');

  const chosen = (products.data?.items ?? []).filter((product) => (copies[product.id] ?? 0) > 0);
  const missing = chosen.filter((product) => !product.barcode);
  const createMissing = useMutation({
    mutationFn: async () => {
      for (const product of missing) await productsApi.createBarcode(product.id);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  });

  const query = search.trim().toLowerCase();
  const shown = (products.data?.items ?? []).filter(
    (product) => !query || product.name.toLowerCase().includes(query) || product.barcode?.includes(query) || product.sku?.toLowerCase().includes(query),
  );
  const labels = chosen.filter((product) => product.barcode).flatMap((product) => Array.from({ length: copies[product.id]! }, () => product));

  const sheet = labels.map((product, index) => (
    <article key={`${product.id}-${index}`} className={symbols === 'barcode' ? 'label' : 'label label--qr'}>
      {symbols !== 'barcode' && <QrImage code={product.barcode!} size={layout === 'roll' ? 72 : 80} label={t.barcodes.qrLabel(product.name)} />}
      <div className="label__text">
        <p className="label__name">{product.name}</p>
        <p className="label__price">{formatMoney(product.price)}</p>
        {symbols !== 'qr' && (
          <BarcodeImage
            value={product.barcode!}
            height={symbols === 'both' ? 24 : layout === 'roll' ? 34 : 40}
            label={t.barcodes.imageLabel(product.name, product.barcode!)}
          />
        )}
      </div>
    </article>
  ));

  function setCount(product: Product, value: number) {
    setCopies((current) => ({ ...current, [product.id]: Math.max(0, Math.min(MAX_COPIES, value)) }));
  }

  return (
    <>
      <style>{PAGE_CSS[layout]}</style>
      <PageHeader title={t.labels.title} description={t.labels.description} />

      <Card title={t.labels.choose}>
        <Field label={t.labels.search}>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </Field>
        {products.isPending && <Loading />}
        {products.isError && <ErrorNotice error={products.error} onRetry={() => products.refetch()} />}
        <ul className="label-picker">
          {shown.map((product) => (
            <li key={product.id} className="label-picker__row">
              <label className="toggle">
                <input type="checkbox" checked={(copies[product.id] ?? 0) > 0} onChange={(event) => setCount(product, event.target.checked ? 1 : 0)} />
                <span>
                  {product.name}
                  <span className="table__secondary">{product.barcode ?? t.labels.noBarcode}</span>
                </span>
              </label>
              {(copies[product.id] ?? 0) > 0 && (
                <input
                  className="input--compact"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_COPIES}
                  aria-label={t.labels.copiesOf(product.name)}
                  value={copies[product.id]}
                  onChange={(event) => setCount(product, Number(event.target.value) || 1)}
                />
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t.labels.print} description={t.labels.count(labels.length)}>
        <div className="segmented" role="radiogroup" aria-label={t.labels.layout}>
          {LAYOUTS.map((option) => (
            <button key={option} type="button" role="radio" aria-checked={layout === option} className="segmented__option" onClick={() => setLayout(option)}>
              {t.labels.layouts[option]}
            </button>
          ))}
        </div>
        <p className="field-hint">{t.labels.layoutHints[layout]}</p>
        <div className="segmented" role="radiogroup" aria-label={t.labels.symbols}>
          {SYMBOLS.map((option) => (
            <button key={option} type="button" role="radio" aria-checked={symbols === option} className="segmented__option" onClick={() => setSymbols(option)}>
              {t.labels.symbolOptions[option]}
            </button>
          ))}
        </div>
        <p className="field-hint">{t.labels.symbolHints[symbols]}</p>
        {missing.length > 0 && (
          <div className="callout">
            <p>{t.labels.missing(missing.length)}</p>
            {canManage(role) && (
              <Button disabled={createMissing.isPending} onClick={() => createMissing.mutate()}>
                {t.labels.createMissing(missing.length)}
              </Button>
            )}
            {createMissing.isError && (
              <p className="form-error" role="alert">
                {errorMessage(createMissing.error)}
              </p>
            )}
          </div>
        )}
        <div className="form-actions">
          <Button variant="primary" disabled={labels.length === 0} onClick={() => window.print()}>
            {t.labels.printButton}
          </Button>
        </div>
      </Card>

      <section className={`labels-print labels-print--${layout}`} aria-label={t.labels.preview}>
        {sheet}
      </section>
      {/* A copy straight on the page body, so printing starts at the top of the paper, away from the app's layout. */}
      {createPortal(
        <div className={`labels-print-root labels-print labels-print--${layout}`} aria-hidden="true">
          {sheet}
        </div>,
        document.body,
      )}
    </>
  );
}
