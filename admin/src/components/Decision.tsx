import { type FormEvent, useId, useState } from 'react';
import type { ApprovalStatus, CountLineStatus, CountStatus } from '../services/types';
import { errorMessage } from '../utils/errors';

const STATUS_LABEL: Record<ApprovalStatus | CountLineStatus | CountStatus, string> = {
  pending: 'Waiting for you',
  approved: 'Approved',
  rejected: 'Rejected',
  match: 'Matched',
  open: 'Counting',
  submitted: 'Waiting for you',
  closed: 'Done',
  cancelled: 'Cancelled',
};

export function StatusPill({ status }: { status: ApprovalStatus | CountLineStatus | CountStatus }) {
  return <span className={`status-pill status-pill--${status}`}>{STATUS_LABEL[status]}</span>;
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
            Why are you rejecting {subject}?
          </label>
          <input
            id={noteId}
            type="text"
            maxLength={500}
            placeholder="Reason the employee will see"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            autoFocus
          />
          <button type="submit" className="button button--danger" disabled={!note.trim() || isBusy}>
            Reject
          </button>
          <button type="button" className="button button--quiet" onClick={() => setIsRejecting(false)}>
            Keep it
          </button>
        </form>
      ) : (
        <div className="decision__buttons">
          <button
            type="button"
            className="button button--primary"
            onClick={onApprove}
            disabled={isBusy}
            aria-label={`Approve ${subject}`}
          >
            Approve
          </button>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => setIsRejecting(true)}
            disabled={isBusy}
            aria-label={`Reject ${subject}`}
          >
            Reject
          </button>
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
