import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { canEditProducts, canOversee } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { useT } from '../i18n/useT';
import { activityApi, productsApi } from '../services/api';
import type { Product } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateTime, formatMoney } from '../utils/format';
import { allowsParts } from '../utils/units';
import { BarcodeImage } from './BarcodeImage';
import { QrImage } from './QrImage';
import { ManagersOnly } from './ManagersOnly';
import { Badge, Button, ButtonLink, Card, Field } from './ui';

/** A product's barcode: scan the manufacturer's in, or let the app make one, then print a label. */
export function BarcodeCard({ product }: { product: Product }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const [onPack, setOnPack] = useState(false);
  const [packSize, setPackSize] = useState('');
  const [packPrice, setPackPrice] = useState('');
  const pack = readPack(packSize, packPrice);
  const canPack = Boolean(product.barcode) && !allowsParts(product.unit);
  const onSaved = (updated: Product) => {
    queryClient.setQueryData(['products', product.id], updated);
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['activity'] });
    setValue('');
    setOnPack(false);
    setPackSize('');
    setPackPrice('');
  };
  const save = useMutation({ mutationFn: (barcode: string | null) => productsApi.setBarcode(product.id, barcode), onSuccess: onSaved });
  const create = useMutation({ mutationFn: () => productsApi.createBarcode(product.id), onSuccess: onSaved });
  const add = useMutation({
    mutationFn: (barcode: string) =>
      productsApi.addBarcode(product.id, barcode, onPack && pack.size ? { packSize: pack.size, ...(pack.price !== null && { packPrice: pack.price }) } : undefined),
    onSuccess: onSaved,
  });
  const packBlocked = canPack && onPack && (pack.size === null || pack.uneven !== null || pack.badPrice);
  const dropOther = useMutation({ mutationFn: (barcode: string) => productsApi.removeBarcode(product.id, barcode), onSuccess: onSaved });
  const error = save.error ?? create.error ?? add.error ?? dropOther.error;
  const busy = save.isPending || create.isPending || add.isPending || dropOther.isPending;

  // With a main barcode already, a scan adds another one so nothing is lost.
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (packBlocked) return;
    if (product.barcode) add.mutate(value.trim());
    else save.mutate(value.trim());
  }

  return (
    <Card title={t.barcodes.title} description={product.barcode ? undefined : t.barcodes.none} className="product-form">
      {product.barcode && (
        <div className="barcode-card__code">
          <div className="barcode-card__symbols">
            <BarcodeImage value={product.barcode} label={t.barcodes.imageLabel(product.name, product.barcode)} />
            <QrImage code={product.barcode} label={t.barcodes.qrLabel(product.name)} />
          </div>
          <p className="field-hint">{t.barcodes.qrHint}</p>
          <div className="form-actions">
            <ButtonLink to={`/labels?products=${product.id}`}>{t.barcodes.printLabel}</ButtonLink>
            <ManagersOnly can={canEditProducts}>
              <Button variant="danger-text" disabled={busy} onClick={() => save.mutate(null)}>
                {t.barcodes.remove}
              </Button>
            </ManagersOnly>
          </div>
          {product.otherBarcodes.length > 0 && (
            <>
              <h3 className="subheading">{t.barcodes.others}</h3>
              <ul className="barcode-others">
                {product.otherBarcodes.map((code) => {
                  const size = product.packs.find((one) => one.barcode === code)?.size;
                  return (
                  <li key={code}>
                    <span className="barcode-others__code">
                      <code>{code}</code>
                      {size && <Badge tone="neutral">{t.barcodes.packOf(size)}</Badge>}
                    </span>
                    <ManagersOnly can={canEditProducts}>
                      <span className="barcode-others__actions">
                        {!size && (
                          <Button variant="ghost" disabled={busy} aria-label={t.barcodes.makeMainLabel(code)} onClick={() => save.mutate(code)}>
                            {t.barcodes.makeMain}
                          </Button>
                        )}
                        <Button variant="danger-text" disabled={busy} aria-label={t.barcodes.removeOtherLabel(code)} onClick={() => dropOther.mutate(code)}>
                          {t.barcodes.removeOther}
                        </Button>
                      </span>
                    </ManagersOnly>
                  </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
      <ManagersOnly can={canEditProducts}>
        <form className="settings-form" onSubmit={handleSubmit}>
          <Field label={product.barcode ? t.barcodes.addAnother : t.barcodes.scanIn} hint={t.barcodes.scanHint}>
            {/* A USB scanner types the code and presses Enter, which saves it. */}
            <input inputMode="numeric" autoComplete="off" maxLength={64} value={value} onChange={(event) => setValue(event.target.value)} />
          </Field>
          {canPack && (
            <label className="toggle">
              <input type="checkbox" checked={onPack} onChange={(event) => setOnPack(event.target.checked)} />
              {t.barcodes.onPack}
            </label>
          )}
          {canPack && onPack && (
            <div className="field-row">
              <Field label={t.barcodes.packSize} narrow error={packSize !== '' && pack.size === null ? t.barcodes.packSizeError : undefined}>
                <input type="number" min={2} max={1000} step={1} inputMode="numeric" required value={packSize} onChange={(event) => setPackSize(event.target.value)} />
              </Field>
              <Field
                label={t.barcodes.packPrice}
                hint={pack.uneven ? undefined : pack.perPiece !== null ? t.barcodes.perPiece(formatMoney(pack.perPiece)) : t.barcodes.packPriceHint}
                error={
                  pack.uneven && (
                    <>
                      {t.barcodes.unevenPack}{' '}
                      {pack.uneven.map((price) => (
                        <Button key={price} variant="ghost" onClick={() => setPackPrice(price.toFixed(2))}>
                          {t.barcodes.usePrice(formatMoney(price))}
                        </Button>
                      ))}
                    </>
                  )
                }
              >
                <input type="number" min={0.01} step="0.01" inputMode="decimal" value={packPrice} onChange={(event) => setPackPrice(event.target.value)} />
              </Field>
            </div>
          )}
          {error && (
            <p className="form-error" role="alert">
              {errorMessage(error)}
            </p>
          )}
          <div className="form-actions">
            <Button type="submit" disabled={value.trim().length < 4 || busy || packBlocked}>
              {product.barcode ? t.barcodes.add : t.barcodes.save}
            </Button>
            {product.barcode && !onPack && (
              <Button disabled={value.trim().length < 4 || busy} onClick={() => save.mutate(value.trim())}>
                {t.barcodes.replaceMain}
              </Button>
            )}
            {!product.barcode && (
              <Button variant="primary" disabled={busy} onClick={() => create.mutate()}>
                {t.barcodes.create}
              </Button>
            )}
          </div>
        </form>
      </ManagersOnly>
      <BarcodeHistory productId={product.id} />
    </Card>
  );
}

/**
 * The pack fields as typed: the size (2 to 1000), and the pack's price with
 * what one piece comes to. A price that doesn't split into whole cents a piece
 * (a sale line is pieces × a price to the cent) gets the nearest two that do.
 */
function readPack(sizeText: string, priceText: string) {
  const sizeNumber = Number(sizeText);
  const size = sizeText.trim() !== '' && Number.isInteger(sizeNumber) && sizeNumber >= 2 && sizeNumber <= 1000 ? sizeNumber : null;
  const priceNumber = Number(priceText.replace(',', '.'));
  const badPrice = priceText.trim() !== '' && !(priceNumber > 0);
  const price = priceText.trim() !== '' && priceNumber > 0 ? priceNumber : null;
  if (size === null || price === null) return { size, price, badPrice, perPiece: null, uneven: null };
  const cents = Math.round(price * 100);
  if (cents % size === 0) return { size, price, badPrice, perPiece: cents / size / 100, uneven: null };
  const lower = Math.floor(cents / size) * size;
  return { size, price, badPrice, perPiece: null, uneven: [lower, lower + size].filter((value) => value > 0).map((value) => value / 100) };
}

/**
 * Every barcode the product has had, newest first, with when and by whom.
 * Read from the same history as the History card, so it costs no extra request.
 */
function BarcodeHistory({ productId }: { productId: number }) {
  const t = useT();
  const { role } = useCurrentUser();
  const history = useQuery({
    queryKey: ['activity', 'history', 'product', productId],
    queryFn: () => activityApi.history('product', productId),
    enabled: canOversee(role),
  });
  const changes = (history.data ?? [])
    .flatMap((entry) => (entry.changes ?? []).filter((change) => change.field === 'barcode').map((change) => ({ entry, to: change.to as string | null })))
    .reverse();
  if (changes.length === 0) return null;
  return (
    <>
      <h3 className="subheading">{t.barcodes.history}</h3>
      <ol className="barcode-history">
        {changes.map(({ entry, to }) => (
          <li key={entry.id}>
            {to ? <code>{to}</code> : <span>{t.barcodes.removedCode}</span>}
            <span className="barcode-history__when">
              <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
              {entry.user && ` · ${t.history.by(entry.user.name)}`}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
