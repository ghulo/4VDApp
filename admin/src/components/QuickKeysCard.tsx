import { ArrowDown, ArrowUp, X } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useT } from '../i18n/useT';
import { TILL_SHELF } from '../pages/counter/shelfAfterSale';
import { counterApi } from '../services/api';
import type { Product } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatMoney } from '../utils/format';
import { ErrorNotice, Loading, SavedToast } from './Feedback';
import { Button, Card, Combobox } from './ui';

const MAX_KEYS = 24;

/** Settings, Counter: the products the till shows as tiles on an empty basket, in the order the owner sets. */
export function QuickKeysCard() {
  const shelf = useQuery({ queryKey: ['counter', 'quick-keys', 'shelf'], queryFn: counterApi.products });
  if (shelf.isPending) return <Loading />;
  if (shelf.isError) return <ErrorNotice error={shelf.error} onRetry={() => shelf.refetch()} />;
  return <QuickKeysForm products={shelf.data} />;
}

function QuickKeysForm({ products }: { products: Product[] }) {
  const t = useT();
  const words = t.counterSettings.quickKeys;
  const queryClient = useQueryClient();
  const initial = useMemo(
    () => products.filter((product) => product.quickKey != null).sort((a, b) => a.quickKey! - b.quickKey!).map((product) => product.id),
    [products],
  );
  const byId = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const [keys, setKeys] = useState(initial);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => counterApi.setQuickKeys(keys),
    onSuccess: () => {
      // This PC's till (if open) and this card read them again.
      void queryClient.invalidateQueries({ queryKey: TILL_SHELF });
      void queryClient.invalidateQueries({ queryKey: ['counter', 'quick-keys'] });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
      setSaved(true);
    },
  });
  const hasChanges = keys.join(',') !== initial.join(',');
  const change = (next: number[]) => {
    setKeys(next);
    setSaved(false);
  };
  const move = (index: number, by: -1 | 1) => {
    const next = [...keys];
    [next[index], next[index + by]] = [next[index + by]!, next[index]!];
    change(next);
  };
  const options = useMemo(
    () =>
      products
        .filter((product) => !keys.includes(product.id))
        .map((product) => ({ value: String(product.id), label: product.name, hint: product.barcode ?? product.sku ?? undefined })),
    [products, keys],
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Card
        title={words.title}
        description={words.description}
        footer={
          <>
            {save.isError && (
              <span className="form-error" role="alert">
                {errorMessage(save.error)}
              </span>
            )}
            {saved && !save.isError && <SavedToast message={words.saved} />}
            <Button type="submit" variant={hasChanges ? 'primary' : 'secondary'} disabled={!hasChanges || save.isPending} loading={save.isPending}>
              {t.settings.saveChanges}
            </Button>
          </>
        }
      >
        {keys.length < MAX_KEYS ? (
          <Combobox
            label={words.add}
            placeholder={words.addPlaceholder}
            options={options}
            value=""
            resetAfterPick
            onChange={(value) => {
              const id = Number(value);
              if (id && !keys.includes(id)) change([...keys, id]);
            }}
          />
        ) : (
          <p className="field__hint">{words.full}</p>
        )}
        {keys.length === 0 ? (
          <p className="quick-keys__empty">{words.empty}</p>
        ) : (
          <ol className="quick-keys">
            {keys.map((id, index) => {
              const product = byId.get(id);
              const name = product?.name ?? `#${id}`;
              return (
                <li key={id} className="quick-keys__row">
                  <span className="quick-keys__place" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="quick-keys__name">{name}</span>
                  {product && <span className="quick-keys__price">{formatMoney(product.price)}</span>}
                  <span className="quick-keys__actions">
                    <Button size="sm" variant="ghost" icon={ArrowUp} aria-label={words.up(name)} title={words.up(name)} disabled={index === 0} onClick={() => move(index, -1)} />
                    <Button size="sm" variant="ghost" icon={ArrowDown} aria-label={words.down(name)} title={words.down(name)} disabled={index === keys.length - 1} onClick={() => move(index, 1)} />
                    <Button size="sm" variant="ghost" icon={X} aria-label={words.remove(name)} title={words.remove(name)} onClick={() => change(keys.filter((other) => other !== id))} />
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </form>
  );
}
