import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { returnsApi } from '../services/api';
import type { ReturnCondition, Sale } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatMoney, inGrams } from '../utils/format';
import { Button } from './ui';
import { ErrorNotice, Loading } from './Feedback';
import { ReceiptLine, RefundMoney } from './RefundMoney';
import { initialChoice, partsOf, type RefundChoice, refundByInput, refundProblem, waitsForOwner } from '../utils/refundChoice';
import { useT } from '../i18n/useT';

/** Return part or all of a sale. The owner's returns go through straight away. */
export function ReturnForm({ sale, onDone }: { sale: Sale; onDone: (message: string) => void }) {
  const queryClient = useQueryClient();
  const t = useT();
  const left = Math.round((sale.quantity - sale.returnedQuantity) * 1000) / 1000;
  // A sale in part units was sold by the kilo, so part of it can come back.
  const byKg = !Number.isInteger(sale.quantity) || !Number.isInteger(left);
  const [quantity, setQuantity] = useState(String(left));
  const [condition, setCondition] = useState<ReturnCondition>('resellable');
  const [refund, setRefund] = useState('');
  const [notes, setNotes] = useState('');
  const info = useQuery({ queryKey: ['returns', 'refund-info', sale.id], queryFn: () => returnsApi.refundInfo(sale.id) });
  const [picked, setPicked] = useState<RefundChoice | null>(null);
  const choice = picked ?? (info.data ? initialChoice(info.data) : null);

  const units = Number(quantity);
  const isQuantityValid = (byKg ? inGrams(units) && units > 0 : Number.isInteger(units) && units >= 1) && units <= left;
  const paid = Math.round(units * sale.pricePerUnit * 100) / 100;
  const refundAmount = refund === '' ? paid : Number(refund);
  const isRefundValid = refundAmount >= 0 && refundAmount <= paid;
  const money = info.data && choice ? partsOf(choice, info.data, isRefundValid ? refundAmount : 0) : null;
  const waits = info.data ? waitsForOwner(info.data, [refundAmount], condition === 'damaged') : false;
  const problem = money && choice && isRefundValid && isQuantityValid ? refundProblem(t, choice, money, refundAmount, waits) : null;

  const mutation = useMutation({
    mutationFn: () =>
      returnsApi.request(sale.id, {
        quantity: units,
        condition,
        ...(refund !== '' && { refundAmount }),
        notes: notes.trim() || null,
        ...(money && choice && { refundBy: refundByInput(choice, money, null) }),
      }),
    onSuccess: (item) => {
      for (const key of ['sales', 'reports', 'inventory', 'products', 'activity', 'approvals', 'money', 'cash']) {
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
      {info.data && <ReceiptLine info={info.data} />}
      <div className="field-row">
        <label className="field">
          <span className="field__label">{t.returnForm.unitsBack}</span>
          <input
            type="number"
            inputMode={byKg ? 'decimal' : 'numeric'}
            min={byKg ? 0.001 : 1}
            max={left}
            step={byKg ? 0.001 : 1}
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

      {info.isPending ? (
        <Loading />
      ) : info.isError ? (
        <ErrorNotice error={info.error} onRetry={() => info.refetch()} />
      ) : (
        choice && <RefundMoney info={info.data} amount={isRefundValid ? refundAmount : 0} waits={waits} choice={choice} onChange={setPicked} />
      )}

      <label className="field">
        <span className="field__label">{t.returnForm.note}</span>
        <input type="text" maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>

      {mutation.isError && (
        <p className="form-error" role="alert">
          {errorMessage(mutation.error)}
        </p>
      )}
      {problem && (
        <p className="field__hint" role="status">
          {problem}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit"
         
          disabled={!isQuantityValid || !isRefundValid || mutation.isPending || !money || problem !== null} variant="primary">
          {mutation.isPending
            ? t.returnForm.returning
            : t.returnForm.returnAndRefund(isRefundValid && isQuantityValid ? formatMoney(refundAmount) : '')}
        </Button>
      </div>
    </form>
  );
}
