import { type FormEvent, useId, useState } from 'react';
import type { ApprovalStatus, CountLineStatus, CountStatus } from '../services/types';
import { errorMessage } from '../utils/errors';
import { Badge, Button, type Tone } from './ui';
import { useT } from '../i18n/useT';

const STATUS_TONE: Record<ApprovalStatus | CountLineStatus | CountStatus, Tone> = {
  pending: 'warn',
  approved: 'ok',
  rejected: 'danger',
  match: 'ok',
  open: 'info',
  submitted: 'warn',
  closed: 'ok',
  cancelled: 'neutral',
};

export function StatusPill({ status }: { status: ApprovalStatus | CountLineStatus | CountStatus }) {
  const t = useT();
  return <Badge tone={STATUS_TONE[status]}>{t.decision.status[status]}</Badge>;
}

interface DecisionControlsProps {
  /** What is being decided, for screen readers: "the return of 2 × Paint". */
  subject: string;
  onApprove: () => void;
  onReject: (note: string) => void;
  isBusy: boolean;
  error: unknown;
}

/**
 * Approve, or reject with a reason. The reason field opens inline instead of
 * a browser prompt, and the employee sees what is typed here.
 */
export function DecisionControls({ subject, onApprove, onReject, isBusy, error }: DecisionControlsProps) {
  const t = useT();
  const [isRejecting, setIsRejecting] = useState(false);
  const [note, setNote] = useState('');
  const noteId = useId();

  function submitRejection(event: FormEvent) {
    event.preventDefault();
    if (note.trim()) onReject(note.trim());
  }

  return (
    <div className="decision">
      {isRejecting ? (
        <form className="decision__reject" onSubmit={submitRejection}>
          <label htmlFor={noteId} className="visually-hidden">
            {t.decision.whyReject(subject)}
          </label>
          <input
            id={noteId}
            type="text"
            maxLength={500}
            placeholder={t.decision.reasonPlaceholder}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            autoFocus
          />
          <Button type="submit" disabled={!note.trim() || isBusy} variant="danger">
            {t.decision.reject}
          </Button>
          <Button onClick={() => setIsRejecting(false)}>
            {t.common.cancel}
          </Button>
        </form>
      ) : (
        <div className="decision__buttons">
          <Button onClick={onApprove}
            disabled={isBusy}
            aria-label={t.decision.approveLabel(subject)} variant="primary">
            {t.decision.approve}
          </Button>
          <Button onClick={() => setIsRejecting(true)} disabled={isBusy} aria-label={t.decision.rejectLabel(subject)}>
            {t.decision.reject}
          </Button>
        </div>
      )}
      {Boolean(error) && (
        <p className="form-error" role="alert">
          {errorMessage(error)}
        </p>
      )}
    </div>
  );
}
