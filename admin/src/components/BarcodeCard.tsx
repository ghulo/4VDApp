import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useT } from '../i18n/useT';
import { productsApi } from '../services/api';
import type { Product } from '../services/types';
import { errorMessage } from '../utils/errors';
import { BarcodeImage } from './BarcodeImage';
import { ManagersOnly } from './ManagersOnly';
import { Button, ButtonLink, Card, Field } from './ui';

/** A product's barcode: scan the manufacturer's in, or let the app make one, then print a label. */
export function BarcodeCard({ product }: { product: Product }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const onSaved = (updated: Product) => {
    queryClient.setQueryData(['products', product.id], updated);
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['activity'] });
    setValue('');
  };
  const save = useMutation({ mutationFn: (barcode: string | null) => productsApi.setBarcode(product.id, barcode), onSuccess: onSaved });
  const create = useMutation({ mutationFn: () => productsApi.createBarcode(product.id), onSuccess: onSaved });
  const error = save.error ?? create.error;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate(value.trim());
  }

  return (
    <Card title={t.barcodes.title} description={product.barcode ? undefined : t.barcodes.none} className="product-form">
      {product.barcode && (
        <div className="barcode-card__code">
          <BarcodeImage value={product.barcode} label={t.barcodes.imageLabel(product.name, product.barcode)} />
          <div className="form-actions">
            <ButtonLink to={`/labels?products=${product.id}`}>{t.barcodes.printLabel}</ButtonLink>
            <ManagersOnly>
              <Button variant="danger-text" disabled={save.isPending} onClick={() => save.mutate(null)}>
                {t.barcodes.remove}
              </Button>
            </ManagersOnly>
          </div>
        </div>
      )}
      <ManagersOnly>
        <form className="settings-form" onSubmit={handleSubmit}>
          <Field label={product.barcode ? t.barcodes.replace : t.barcodes.scanIn} hint={t.barcodes.scanHint}>
            {/* A USB scanner types the code and presses Enter, which saves it. */}
            <input inputMode="numeric" autoComplete="off" maxLength={64} value={value} onChange={(event) => setValue(event.target.value)} />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {errorMessage(error)}
            </p>
          )}
          <div className="form-actions">
            <Button type="submit" disabled={value.trim().length < 4 || save.isPending}>
              {t.barcodes.save}
            </Button>
            {!product.barcode && (
              <Button variant="primary" disabled={create.isPending} onClick={() => create.mutate()}>
                {t.barcodes.create}
              </Button>
            )}
          </div>
        </form>
      </ManagersOnly>
    </Card>
  );
}
