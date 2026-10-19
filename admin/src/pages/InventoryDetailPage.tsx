import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExpiryCard } from '../components/ExpiryCard';
import { type FormEvent, useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { errorMessage } from '../utils/errors';
import { StockTag } from '../components/StockTag';
import { WriteOffForm } from '../components/WriteOffForm';
import { inventoryApi } from '../services/api';
import { type InventoryDetail, MANUAL_STOCK_REASONS, type RecordSource, type StockReason } from '../services/types';
import { formatDate, formatDateTime, formatSignedQuantity } from '../utils/format';
import { SourceFilter, TrefinTag } from '../components/TrefinParts';
import { Button, Card } from '../components/ui';
import { Minus, Plus } from '@phosphor-icons/react';
import { ManagersOnly } from '../components/ManagersOnly';
import { useT } from '../i18n/useT';

/** The Stock tab of a product's page: what's on the shelf, changing it, and its history. */
export function ProductStockTab() {
  const t = useT();
  const productId = Number(useParams().id);
  const query = useQuery({
    queryKey: ['inventory', productId],
    queryFn: () => inventoryApi.get(productId),
  });

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorNotice error={query.error} onRetry={() => query.refetch()} />;

  const item = query.data;
  return (
    <>
      <ExpiryCard productId={item.productId} />

      <div className="split">
        <Card title={t.inventory.onShelf}>
          <div className="stock-hero">
            <StockTag quantity={item.quantity} reorderLevel={item.reorderLevel} size="large" />
            {/* Written here rather than taken from the server, so they follow the language. */}
            {item.quantity === 0 ? (
              <p className="stock-hero__warning">{t.inventory.outWarning}</p>
            ) : item.quantity <= item.reorderLevel ? (
              <p className="stock-hero__warning">{t.inventory.lowWarning(item.reorderLevel)}</p>
            ) : (
              <p className="stock-hero__note">{t.inventory.alertAt(item.reorderLevel)}</p>
            )}
          </div>
          <AdjustStockForm item={item} />
          <h3 className="subheading">{t.inventory.lossTitle}</h3>
          <p className="field-hint">{t.inventory.lossHint}</p>
          <WriteOffForm productId={item.productId} inStock={item.quantity} />
        </Card>

        <StockHistoryCard item={item} />
      </div>
    </>
  );
}

/**
 * Every stock change, newest first: 4VD's own, then TREFIN's starting stocks,
 * corrections and counts for this product (history only, with its tag).
 */
function StockHistoryCard({ item }: { item: InventoryDetail }) {
  const t = useT();
  const [source, setSource] = useState<RecordSource | undefined>();
  const own = source === 'trefin' ? [] : item.recentAdjustments;
  const trefin = source === '4vd' ? [] : item.trefinHistory;
  return (
    <Card title={t.inventory.history} actions={item.trefinHistory.length > 0 ? <SourceFilter value={source} onChange={setSource} /> : undefined}>
      {own.length === 0 && trefin.length === 0 ? (
        <EmptyState title={t.inventory.noChanges} />
      ) : (
        <ol className="history">
          {own.map((adjustment) => (
            <li key={adjustment.id} className="history__row">
              <span className={`history__qty ${adjustment.quantity > 0 ? 'history__qty--in' : 'history__qty--out'}`}>
                {formatSignedQuantity(adjustment.quantity)}
              </span>
              <span className="history__what">
                {t.stockReasons[adjustment.reason] ?? adjustment.reason}
                {adjustment.notes && <span className="history__notes">{adjustment.notes}</span>}
              </span>
              <span className="history__when">
                {formatDateTime(adjustment.date)}
                {adjustment.adjustedBy && <span>{adjustment.adjustedBy}</span>}
              </span>
            </li>
          ))}
          {trefin.map((line) => (
            <li key={`t${line.id}`} className="history__row">
              <span className={`history__qty ${line.kind === 'opening' ? '' : line.quantity > 0 ? 'history__qty--in' : 'history__qty--out'}`}>
                {line.kind === 'opening' ? line.quantity : formatSignedQuantity(line.quantity)}
              </span>
              <span className="history__what">
                <span>
                  <Link to={`/counts/trefin/${line.documentId}`}>{t.fromTrefin.stockKinds[line.kind]}</Link> <TrefinTag />
                </span>
                {line.counted !== null && <span className="history__notes">{t.fromTrefin.counted(String(line.counted))}</span>}
              </span>
              <span className="history__when">
                {formatDate(`${line.dated}T12:00:00`)}
                <span>{t.fromTrefin.databases[line.source] ?? line.source}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

type Direction = 'add' | 'remove';

function AdjustStockForm({ item }: { item: InventoryDetail }) {
  const queryClient = useQueryClient();
  const t = useT();
  const [direction, setDirection] = useState<Direction>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<StockReason>('Restock');
  const [notes, setNotes] = useState('');
  const [reorderLevel, setReorderLevel] = useState(String(item.reorderLevel));
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof inventoryApi.adjust>[1]) => inventoryApi.adjust(item.productId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(['inventory', item.productId], updated);
      // Lists and product pages show stock too; refetch them next time they're viewed.
      queryClient.invalidateQueries({ queryKey: ['inventory'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      setAmount('');
      setNotes('');
      setSavedMessage(t.inventory.nowAt(updated.quantity));
    },
  });

  function chooseDirection(next: Direction) {
    setDirection(next);
    setReason(next === 'add' ? 'Restock' : 'Manual adjustment');
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSavedMessage(null);
    const parsedAmount = Number(amount);
    const parsedReorder = Number(reorderLevel);
    const reorderChanged = reorderLevel !== '' && parsedReorder !== item.reorderLevel;

    mutation.mutate({
      ...(parsedAmount > 0 && {
        quantity: direction === 'add' ? parsedAmount : -parsedAmount,
        reason,
        notes: notes.trim() || null,
      }),
      ...(reorderChanged && { reorderLevel: parsedReorder }),
    });
  }

  const amountId = useId();
  const count = Math.max(0, Math.floor(Number(amount) || 0));
  const max = direction === 'remove' ? item.quantity : Infinity;
  const after = item.quantity + (direction === 'add' ? count : -count);
  const step = (by: number) => setAmount(String(Math.min(max, Math.max(0, count + by)) || ''));
  const reasons = MANUAL_STOCK_REASONS.filter((option) => direction === 'add' || option !== 'Restock');
  const hasChange = Number(amount) > 0 || (reorderLevel !== '' && Number(reorderLevel) !== item.reorderLevel);

  return (
    <ManagersOnly note={t.inventory.managersOnly}>
      <form className="adjust-form" onSubmit={handleSubmit}>
        <div className="segmented" role="radiogroup" aria-label={t.inventory.addOrRemove}>
          {(['add', 'remove'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={direction === option}
              className="segmented__option"
              onClick={() => chooseDirection(option)}
            >
              {option === 'add' ? t.inventory.add : t.inventory.remove}
            </button>
          ))}
        </div>

        <div className="field-row">
          <div className="field">
            <label className="field__label" htmlFor={amountId}>
              {t.inventory.howMany}
            </label>
            {/* Most changes are a few units: the buttons count them without typing. */}
            <span className="stepper">
              <Button aria-label={t.inventory.oneLess} icon={Minus} disabled={count <= 0} onClick={() => step(-1)} />
              <input
                id={amountId}
                type="number"
                inputMode="numeric"
                min={1}
                max={direction === 'remove' ? item.quantity : undefined}
                step={1}
                placeholder="0"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              <Button aria-label={t.inventory.oneMore} icon={Plus} disabled={count >= max} onClick={() => step(1)} />
            </span>
            {/* What the shelf will hold once this is saved, before you save it. */}
            <span className="adjust-form__after" aria-live="polite">
              {count > 0 && t.inventory.afterChange(item.quantity, after)}
            </span>
          </div>
          <label className="field">
            <span className="field__label">{t.inventory.reason}</span>
            <select value={reason} onChange={(event) => setReason(event.target.value as StockReason)}>
              {reasons.map((option) => (
                <option key={option} value={option}>
                  {t.stockReasons[option] ?? option}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span className="field__label">{t.inventory.note}</span>
          <input type="text" maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>

        <h3 className="subheading">{t.inventory.alertTitle}</h3>
        <label className="field field--narrow">
          <span className="field__label">{t.inventory.warnAt}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={reorderLevel}
            onChange={(event) => setReorderLevel(event.target.value)}
          />
        </label>

        {mutation.isError && (
          <p className="form-error" role="alert">
            {errorMessage(mutation.error)}
          </p>
        )}
        {savedMessage && (
          <p className="form-success" role="status">
            {savedMessage}
          </p>
        )}

        <Button type="submit" disabled={!hasChange || mutation.isPending} variant="primary" loading={mutation.isPending}>
          {t.inventory.save}
        </Button>
      </form>
    </ManagersOnly>
  );
}
