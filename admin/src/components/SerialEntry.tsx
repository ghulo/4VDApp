import { X } from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent, useId, useState } from 'react';
import { useT } from '../i18n/useT';
import { serialsApi } from '../services/api';
import { errorMessage } from '../utils/errors';
import { Button, Field, useToast } from './ui';

/**
 * Serial numbers coming in: scan or type one, Enter, the next. Each shows as
 * a chip that can be taken off before Record. The bill or stock-in they came
 * on is kept with them, so a serial can later be traced to its supplier.
 */
export function SerialEntry({ productId, billId, stockDocumentId, max, onRecorded }: { productId: number; billId?: number; stockDocumentId?: number; max?: number; onRecorded?: () => void }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const hintId = useId();
  const [text, setText] = useState('');
  const [list, setList] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const full = max !== undefined && list.length >= max;

  const record = useMutation({
    mutationFn: () => serialsApi.add({ productId, serials: list, billId: billId ?? null, stockDocumentId: stockDocumentId ?? null }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['serials'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      toast({ title: t.serials.added(result.added), detail: result.alreadyInStock.length > 0 ? t.serials.already(result.alreadyInStock.join(', ')) : undefined, tone: result.alreadyInStock.length > 0 ? 'info' : 'ok' });
      setList([]);
      onRecorded?.();
    },
  });

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const serial = text.trim();
    if (!serial || full) return;
    if (list.some((one) => one.toLowerCase() === serial.toLowerCase())) {
      setProblem(t.serials.twice);
      return;
    }
    setList((now) => [...now, serial]);
    setText('');
    setProblem(null);
  }

  return (
    <div className="serial-entry">
      <Field label={t.serials.entry} hint={max !== undefined ? t.serials.progress(list.length, max) : t.serials.addHint} error={problem ?? undefined}>
        <input
          autoComplete="off"
          spellCheck={false}
          maxLength={100}
          placeholder={t.serials.searchPlaceholder}
          aria-describedby={max !== undefined ? hintId : undefined}
          disabled={full}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setProblem(null);
          }}
          onKeyDown={handleKey}
        />
      </Field>
      {max !== undefined && (
        <span id={hintId} className="visually-hidden">
          {t.serials.addHint}
        </span>
      )}
      {list.length > 0 && (
        <ul className="serial-chips" aria-label={t.serials.entry}>
          {list.map((serial) => (
            <li key={serial} className="serial-chip">
              <span className="serial-code">{serial}</span>
              <button type="button" className="serial-chip__remove" aria-label={t.serials.remove(serial)} onClick={() => setList((now) => now.filter((one) => one !== serial))}>
                <X size={12} weight="bold" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {record.isError && (
        <p className="form-error" role="alert">
          {errorMessage(record.error)}
        </p>
      )}
      {list.length > 0 && (
        <div className="form-actions">
          <Button variant="primary" loading={record.isPending} disabled={record.isPending} onClick={() => record.mutate()}>
            {t.serials.record(list.length)}
          </Button>
        </div>
      )}
    </div>
  );
}
