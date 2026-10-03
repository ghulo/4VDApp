import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../i18n/useT';
import { activityApi } from '../../services/api';
import type { ActivityEntry } from '../../services/types';
import { errorMessage } from '../../utils/errors';
import { Button } from '../ui';
import { effectSentence } from './activityText';

/** An undo changes stock, money and whatever was edited, so everything that shows them refreshes. */
const AFFECTED_QUERIES = ['activity', 'reports', 'inventory', 'products', 'sales', 'approvals', 'promotions', 'settings'];

interface UndoConfirmProps {
  entry: ActivityEntry & { undo: NonNullable<ActivityEntry['undo']> };
  mode: 'undo' | 'restore';
  /** Called after success or cancel; the page puts focus back on the row's button. */
  onClose: () => void;
  /** So the row's button can point at this panel (aria-controls). */
  id: string;
}

/**
 * The confirmation that opens under an entry: what the undo (or restore) will
 * do, an optional reason the person sees, and the button that does it.
 */
export function UndoConfirm({ entry, mode, onClose, id }: UndoConfirmProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const noteId = useId();
  const hintId = useId();
  const kind = t.undo.kinds[entry.undo.kind];

  const action = useMutation({
    mutationFn: () => (mode === 'undo' ? activityApi.undo(entry.id, note.trim()) : activityApi.restore(entry.id)),
    onSuccess: async () => {
      await Promise.all(AFFECTED_QUERIES.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      onClose();
    },
  });

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!action.isPending) action.mutate();
  }

  function cancelOnEscape(event: KeyboardEvent) {
    if (event.key === 'Escape' && !action.isPending) {
      event.stopPropagation();
      onClose();
    }
  }

  const lines = effectSentence(t, entry.undo.effect, mode);
  if (entry.undo.kind === 'promotion' && mode === 'undo') lines.push(t.undo.promotionEnds);

  return (
    <form
      id={id}
      className="undo-confirm"
      aria-labelledby={headingId}
      aria-busy={action.isPending}
      onSubmit={submit}
      onKeyDown={cancelOnEscape}
    >
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="undo-confirm__title">
        {t.undo.title(mode, kind)}
      </h2>
      {lines.length > 0 && (
        <ul className="undo-confirm__effects">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {mode === 'undo' && (
        <div className="undo-confirm__reason">
          <label htmlFor={noteId}>{t.undo.reason}</label>
          <input
            id={noteId}
            type="text"
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-describedby={hintId}
            disabled={action.isPending}
          />
          <span id={hintId} className="field__hint">
            {t.undo.reasonHint}
          </span>
        </div>
      )}
      {action.isError && (
        <p className="form-error" role="alert">
          {errorMessage(action.error)}
        </p>
      )}
      <div className="undo-confirm__buttons">
        <Button type="submit" variant={mode === 'undo' ? 'danger' : 'primary'} disabled={action.isPending}>
          {action.isPending ? t.undo.working : t.undo.confirm(mode, kind)}
        </Button>
        <Button onClick={onClose} disabled={action.isPending}>
          {t.common.cancel}
        </Button>
      </div>
    </form>
  );
}
