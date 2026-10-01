import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { errorMessage } from '../utils/errors';
import { StockTag } from '../components/StockTag';
import { inventoryApi } from '../services/api';
import { type InventoryDetail, MANUAL_STOCK_REASONS, type StockReason } from '../services/types';
import { formatDateTime, formatSignedQuantity } from '../utils/format';

export function InventoryDetailPage() {
  const productId = Number(useParams().productId);
  const query = useQuery({
    queryKey: ['inventory', productId],
    queryFn: () => inventoryApi.get(productId),
  });

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorNotice error={query.error} onRetry={() => query.refetch()} />;

  const item = query.data;
  return (
    <>
      <header className="page-header">
        <Link to="/inventory" className="back-link">
          Stock
        </Link>
        <h1 className="page-title">{item.productName}</h1>
        {item.sku && <p className="page-intro">SKU {item.sku}</p>}
      </header>

      <div className="split">
        <section className="panel" aria-labelledby="level-heading">
          <h2 id="level-heading" className="panel__title">
            On the shelf
          </h2>
          <div className="stock-hero">
            <StockTag quantity={item.quantity} reorderLevel={item.reorderLevel} size="large" />
            {item.warnings.map((warning) => (
              <p key={warning} className="stock-hero__warning">
                {warning}
              </p>
            ))}
          </div>
          <AdjustStockForm item={item} />
        </section>

        <section className="panel" aria-labelledby="history-heading">
          <h2 id="history-heading" className="panel__title">
            History
          </h2>
          {item.recentAdjustments.length === 0 ? (
            <EmptyState title="No changes yet" />
          ) : (
            <ol className="history">
              {item.recentAdjustments.map((adjustment) => (
                <li key={adjustment.id} className="history__row">
                  <span className={`history__qty ${adjustment.quantity > 0 ? 'history__qty--in' : 'history__qty--out'}`}>
                    {formatSignedQuantity(adjustment.quantity)}
                  </span>
                  <span className="history__what">
                    {adjustment.reason}
                    {adjustment.notes && <span className="history__notes">{adjustment.notes}</span>}
                  </span>
                  <span className="history__when">
                    {formatDateTime(adjustment.date)}
                    {adjustment.adjustedBy && <span>{adjustment.adjustedBy}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}

type Direction = 'add' | 'remove';

function AdjustStockForm({ item }: { item: InventoryDetail }) {
  const queryClient = useQueryClient();
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
      setAmount('');
      setNotes('');
      setSavedMessage(`Stock is now ${updated.quantity}.`);
    },
  });

  function chooseDirection(next: Direction) {
    setDirection(next);
    setReason(next === 'add' ? 'Restock' : 'Damage');
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

  const reasons = MANUAL_STOCK_REASONS.filter((option) =>
    direction === 'add' ? option !== 'Damage' : option !== 'Restock' && option !== 'Return',
  );
  const hasChange = Number(amount) > 0 || (reorderLevel !== '' && Number(reorderLevel) !== item.reorderLevel);

  return (
    <form className="adjust-form" onSubmit={handleSubmit}>
      <div className="segmented" role="radiogroup" aria-label="Add or remove stock">
        {(['add', 'remove'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={direction === option}
            className="segmented__option"
            onClick={() => chooseDirection(option)}
          >
            {option === 'add' ? 'Add stock' : 'Remove stock'}
          </button>
        ))}
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field__label">How many</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={direction === 'remove' ? item.quantity : undefined}
            step={1}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Reason</span>
          <select value={reason} onChange={(event) => setReason(event.target.value as StockReason)}>
            {reasons.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span className="field__label">Note (optional)</span>
        <input type="text" maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>

      <label className="field field--narrow">
        <span className="field__label">Warn me when stock reaches</span>
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

      <button type="submit" className="button button--primary" disabled={!hasChange || mutation.isPending}>
        {mutation.isPending ? 'Saving…' : 'Save stock change'}
      </button>
    </form>
  );
}
