import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { writeOffsApi } from '../services/api';
import { WRITE_OFF_REASONS, type WriteOffReason } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatMoney } from '../utils/format';

const REASON_LABEL: Record<WriteOffReason, string> = {
  damaged: 'Damaged',
  lost: 'Lost',
  expired: 'Expired',
  other: 'Other',
};

/** Take damaged, lost or expired stock out as a recorded loss. */
export function WriteOffForm({ productId, inStock }: { productId: number; inStock: number }) {
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<WriteOffReason>('damaged');
  const [notes, setNotes] = useState('');
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const units = Number(quantity);
  const isValid = Number.isInteger(units) && units >= 1 && units <= inStock;

  const mutation = useMutation({
    mutationFn: () => writeOffsApi.request({ productId, quantity: units, reason, notes: notes.trim() || null }),
    onSuccess: (writeOff) => {
      for (const key of ['inventory', 'products', 'reports', 'activity']) queryClient.invalidateQueries({ queryKey: [key] });
      setQuantity('');
      setNotes('');
      setSavedMessage(
        writeOff.value === null
          ? `Wrote off ${writeOff.quantity}. There's no cost price, so the loss has no value.`
          : `Wrote off ${writeOff.quantity}, a loss of ${formatMoney(writeOff.value)} at cost.`,
      );
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSavedMessage(null);
    mutation.mutate();
  }

  return (
    <form className="adjust-form" onSubmit={handleSubmit}>
      <div className="field-row">
        <label className="field">
          <span className="field__label">How many</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={inStock}
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Why</span>
          <select value={reason} onChange={(event) => setReason(event.target.value as WriteOffReason)}>
            {WRITE_OFF_REASONS.map((option) => (
              <option key={option} value={option}>
                {REASON_LABEL[option]}
              </option>
            ))}
          </select>
        </label>
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
      {savedMessage && (
        <p className="form-success" role="status">
          {savedMessage}
        </p>
      )}
      <button type="submit" className="button button--danger" disabled={!isValid || mutation.isPending}>
        {mutation.isPending ? 'Writing off…' : 'Write off'}
      </button>
    </form>
  );
}
