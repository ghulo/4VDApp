import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { returnsApi } from '../services/api';
import type { ReturnCondition, Sale } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatMoney } from '../utils/format';
import { Button } from './ui';

/** Return part or all of a sale. The owner's returns go through straight away. */
export function ReturnForm({ sale, onDone }: { sale: Sale; onDone: (message: string) => void }) {
  const queryClient = useQueryClient();
  const left = sale.quantity - sale.returnedQuantity;
  const [quantity, setQuantity] = useState(String(left));
  const [condition, setCondition] = useState<ReturnCondition>('resellable');
  const [refund, setRefund] = useState('');
  const [notes, setNotes] = useState('');

  const units = Number(quantity);
  const isQuantityValid = Number.isInteger(units) && units >= 1 && units <= left;
  const paid = Math.round(units * sale.pricePerUnit * 100) / 100;
  const refundAmount = refund === '' ? paid : Number(refund);
  const isRefundValid = refundAmount >= 0 && refundAmount <= paid;

  const mutation = useMutation({
    mutationFn: () =>
      returnsApi.request(sale.id, {
        quantity: units,
        condition,
        ...(refund !== '' && { refundAmount }),
        notes: notes.trim() || null,
      }),
    onSuccess: (item) => {
      for (const key of ['sales', 'reports', 'inventory', 'products', 'activity', 'approvals']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      onDone(
        item.condition === 'damaged'
          ? `Refunded ${formatMoney(item.refundAmount)} and wrote off ${item.quantity} damaged.`
          : `Refunded ${formatMoney(item.refundAmount)} and put ${item.quantity} back in stock.`,
      );
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <form className="return-form" onSubmit={handleSubmit}>
      <div className="field-row">
        <label className="field">
          <span className="field__label">Units coming back</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={left}
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
          <span className="field-hint">
            {left} of {sale.quantity} can still be returned
          </span>
        </label>
        <label className="field">
          <span className="field__label">Refund</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={paid}
            step={0.01}
            placeholder={isQuantityValid ? String(paid) : ''}
            value={refund}
            onChange={(event) => setRefund(event.target.value)}
          />
          <span className="field-hint">They paid {isQuantityValid ? formatMoney(paid) : '…'}</span>
        </label>
      </div>

      <div className="segmented" role="radiogroup" aria-label="Condition">
        {(['resellable', 'damaged'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={condition === option}
            className="segmented__option"
            onClick={() => setCondition(option)}
          >
            {option === 'resellable' ? 'Back on the shelf' : 'Damaged, write it off'}
          </button>
        ))}
      </div>

      <label className="field">
        <span className="field__label">Note (optional)</span>
        <input type="text" maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>

      {mutation.isError && (
        <p className="form-error" role="alert">
          {errorMessage(mutation.error)}
        </p>
      )}
      <Button type="submit"
       
        disabled={!isQuantityValid || !isRefundValid || mutation.isPending} variant="primary">
        {mutation.isPending ? 'Returning…' : `Return and refund ${isRefundValid && isQuantityValid ? formatMoney(refundAmount) : ''}`}
      </Button>
    </form>
  );
}
