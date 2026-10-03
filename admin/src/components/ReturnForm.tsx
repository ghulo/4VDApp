import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { returnsApi } from '../services/api';
import type { ReturnCondition, Sale } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatMoney } from '../utils/format';
import { Button } from './ui';
import { useT } from '../i18n/useT';

/** Return part or all of a sale. The owner's returns go through straight away. */
export function ReturnForm({ sale, onDone }: { sale: Sale; onDone: (message: string) => void }) {
  const queryClient = useQueryClient();
  const t = useT();
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
          ? t.returnForm.refundedDamaged({ amount: formatMoney(item.refundAmount), quantity: item.quantity })
          : t.returnForm.refundedBack({ amount: formatMoney(item.refundAmount), quantity: item.quantity }),
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
          <span className="field__label">{t.returnForm.unitsBack}</span>
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
            {t.returnForm.canReturn(left, sale.quantity)}
          </span>
        </label>
        <label className="field">
          <span className="field__label">{t.returnForm.refund}</span>
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
          <span className="field-hint">{t.returnForm.theyPaid(isQuantityValid ? formatMoney(paid) : '…')}</span>
        </label>
      </div>

      <div className="segmented" role="radiogroup" aria-label={t.returnForm.condition}>
        {(['resellable', 'damaged'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={condition === option}
            className="segmented__option"
            onClick={() => setCondition(option)}
          >
            {option === 'resellable' ? t.returnForm.resellable : t.returnForm.damaged}
          </button>
        ))}
      </div>

      <label className="field">
        <span className="field__label">{t.returnForm.note}</span>
        <input type="text" maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>

      {mutation.isError && (
        <p className="form-error" role="alert">
          {errorMessage(mutation.error)}
        </p>
      )}
      <Button type="submit"
       
        disabled={!isQuantityValid || !isRefundValid || mutation.isPending} variant="primary">
        {mutation.isPending
          ? t.returnForm.returning
          : t.returnForm.returnAndRefund(isRefundValid && isQuantityValid ? formatMoney(refundAmount) : '')}
      </Button>
    </form>
  );
}
