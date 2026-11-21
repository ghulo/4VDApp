import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LocationSelect } from './LocationSelect';
import type { ProductUnit } from '../services/types';
import { allowsParts } from '../utils/units';
import { type FormEvent, useState } from 'react';
import { writeOffsApi } from '../services/api';
import { WRITE_OFF_REASONS, type WriteOffReason } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatMoney, inGrams } from '../utils/format';
import { Button } from './ui';
import { useT } from '../i18n/useT';
import { SavedToast } from './Feedback';
import { ProjectSelect } from './ProjectSelect';
import { decimalFromText } from '../utils/decimalText';

/** Take damaged, lost or expired stock out as a recorded loss. */
export function WriteOffForm({ productId, inStock, unit }: { productId: number; inStock: number; unit?: ProductUnit }) {
  const queryClient = useQueryClient();
  const t = useT();
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<WriteOffReason>('damaged');
  const [notes, setNotes] = useState('');
  const [locationId, setLocationId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const byKg = allowsParts(unit) || !Number.isInteger(inStock);
  const units = decimalFromText(quantity);
  const isValid = (byKg ? inGrams(units) && units > 0 : Number.isInteger(units) && units >= 1) && units <= inStock;

  const mutation = useMutation({
    mutationFn: () => writeOffsApi.request({ productId, quantity: units, reason, notes: notes.trim() || null, locationId, projectId }),
    onSuccess: (writeOff) => {
      for (const key of ['inventory', 'products', 'reports', 'activity']) queryClient.invalidateQueries({ queryKey: [key] });
      setQuantity('');
      setNotes('');
      setSavedMessage(
        writeOff.value === null
          ? t.writeOff.noCost(writeOff.quantity)
          : t.writeOff.withCost(writeOff.quantity, formatMoney(writeOff.value)),
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
          <span className="field__label">{t.writeOff.howMany}</span>
          <input
            type="text"
            inputMode={byKg ? 'decimal' : 'numeric'}
            autoComplete="off"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">{t.writeOff.why}</span>
          <select value={reason} onChange={(event) => setReason(event.target.value as WriteOffReason)}>
            {WRITE_OFF_REASONS.map((option) => (
              <option key={option} value={option}>
                {t.writeOff.reasons[option]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <LocationSelect coming="out" value={locationId} onChange={setLocationId} />
      <ProjectSelect value={projectId} onChange={setProjectId} />
      <label className="field">
        <span className="field__label">{t.writeOff.note}</span>
        <input type="text" maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      {mutation.isError && (
        <p className="form-error" role="alert">
          {errorMessage(mutation.error)}
        </p>
      )}
      {savedMessage && (
        <SavedToast message={savedMessage} />
      )}
      <Button type="submit" disabled={!isValid || mutation.isPending} variant="danger" loading={mutation.isPending}>
        {t.writeOff.writeOff}
      </Button>
    </form>
  );
}
