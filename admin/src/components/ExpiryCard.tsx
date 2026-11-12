import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useT } from '../i18n/useT';
import { expiryApi } from '../services/api';
import { errorMessage } from '../utils/errors';
import { formatDateWith } from '../utils/format';
import { ErrorNotice, Loading } from './Feedback';
import { Badge, Button, Card, DateField, Field, RemoveButton } from './ui';

/** Same as the server: warnings start a week ahead, urgent in the last two days. */
const WARNING_DAYS = 7;
const URGENT_DAYS = 2;

const formatDay = (day: string) =>
  formatDateWith(new Date(`${day}T00:00:00Z`), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** When this product's stock expires, and marking it dealt with. */
/**
 * A product's expiry dates. Split in two on the product page: with dates it is
 * a card at the top (place="top"), where a date running out can't be missed;
 * with none it is a quiet key under the stock cards (place="end") instead of a
 * stray link above them. Without a place it shows whichever case applies.
 */
export function ExpiryCard({ productId, place }: { productId: number; place?: 'top' | 'end' }) {
  const t = useT();
  const queryClient = useQueryClient();
  const expiry = useQuery({ queryKey: ['expiry', productId], queryFn: () => expiryApi.forProduct(productId) });
  const [quantity, setQuantity] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  // Most products never expire, so the form stays folded away until asked for.
  const [adding, setAdding] = useState(false);
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['expiry'] });
    queryClient.invalidateQueries({ queryKey: ['reports', 'insights'] });
    queryClient.invalidateQueries({ queryKey: ['activity'] });
  };
  const add = useMutation({
    mutationFn: () => expiryApi.add({ productId, quantity: Number(quantity), expiresOn, note: null }),
    onSuccess: () => {
      invalidate();
      setQuantity('');
      setExpiresOn('');
      setAdding(false);
    },
  });
  const clear = useMutation({ mutationFn: expiryApi.clear, onSuccess: invalidate });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    add.mutate();
  }

  const hasDates = (expiry.data?.length ?? 0) > 0;
  // Each place shows only its own case; both read the same cached list.
  if (place === 'top' && !hasDates && !expiry.isError) return null;
  if (place === 'end' && (hasDates || expiry.isPending || expiry.isError)) return null;
  if (!hasDates && !adding && !expiry.isPending && !expiry.isError) {
    return (
      <div className="form-actions">
        <Button variant="ghost" onClick={() => setAdding(true)}>
          {t.expiry.open}
        </Button>
      </div>
    );
  }

  return (
    <Card title={t.expiry.title} description={t.expiry.description}>
      {expiry.isPending && <Loading />}
      {expiry.isError && <ErrorNotice error={expiry.error} onRetry={() => expiry.refetch()} />}
      {hasDates && (
        <ul className="plain-list">
          {expiry.data!.map((row) => (
            <li key={row.id} className="expiry-row">
              <span>
                {t.expiry.units(row.remaining)} · {formatDay(row.expiresOn)}{' '}
                {row.daysLeft <= URGENT_DAYS ? (
                  <Badge tone="danger">{t.expiry.left(row.daysLeft)}</Badge>
                ) : row.daysLeft <= WARNING_DAYS ? (
                  <Badge tone="warn">{t.expiry.left(row.daysLeft)}</Badge>
                ) : null}
                {row.note && <span className="table__secondary">{row.note}</span>}
              </span>
              <RemoveButton
                size="md"
                variant="ghost"
                pending={clear.isPending}
                aria-label={t.expiry.dealtWithLabel(formatDay(row.expiresOn))}
                confirm={t.expiry.confirmDealtWith}
                onConfirm={() => clear.mutate(row.id)}
              >
                {t.expiry.dealtWith}
              </RemoveButton>
            </li>
          ))}
        </ul>
      )}
      {clear.isError && (
        <p className="form-error" role="alert">
          {errorMessage(clear.error)}
        </p>
      )}
      {adding ? (
        <form className="settings-form" onSubmit={handleSubmit} aria-label={t.expiry.add}>
          <div className="field-row">
            <Field label={t.expiry.quantity} narrow>
              <input type="number" inputMode="numeric" required min={1} step={1} value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            </Field>
            <Field label={t.expiry.expiresOn}>
              <DateField required value={expiresOn} onChange={(value) => setExpiresOn(value)} />
            </Field>
          </div>
          {add.isError && (
            <p className="form-error" role="alert">
              {errorMessage(add.error)}
            </p>
          )}
          <Button type="submit" disabled={!(Number(quantity) >= 1) || expiresOn === '' || add.isPending}>
            {t.expiry.add}
          </Button>
        </form>
      ) : (
        <Button variant="ghost" onClick={() => setAdding(true)}>
          {t.expiry.open}
        </Button>
      )}
    </Card>
  );
}
