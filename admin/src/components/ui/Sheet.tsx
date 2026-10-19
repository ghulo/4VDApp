import { X } from '@phosphor-icons/react';
import { Fragment, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useT } from '../../i18n/useT';
import { useSwipeToDismiss } from './useSwipeToDismiss';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /** 'center': a short yes-or-no question in the middle of the screen, not a form from the side. */
  placement?: 'side' | 'center';
  children: ReactNode;
}

/**
 * A panel that slides in from the right over a dimmed page, for a form that
 * would otherwise sit in the middle of a list page. The browser's own modal
 * dialog keeps focus inside, closes on Esc and returns focus afterwards. The
 * form inside starts fresh each time the panel opens.
 */
export function Sheet({ open, onClose, title, description, placement = 'side', children }: SheetProps) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  // The form stays on the panel while it slides out, then goes, so the next
  // opening starts fresh. Each opening gets its own key for the same reason.
  const [shown, setShown] = useState(open);
  const [opening, setOpening] = useState(0);
  if (open && !shown) setShown(true);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpening((count) => count + 1);
  }
  // On a touch screen the panel can be swiped back out to the right.
  useSwipeToDismiss(ref, { side: 'right', closed: 'translateX(100%)', onDismiss: onClose, enabled: open && placement === 'side' });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal?.();
      // Start in the form's first field, ready to type or scan, not on the close button.
      dialog.querySelector<HTMLElement>('.sheet__body :is(input, select, textarea, [data-autofocus]):not([disabled])')?.focus();
    }
    if (!open) {
      // Esc closes the dialog itself before this runs.
      if (dialog.open) dialog.close();
      // Wait for the slide out (none under reduced motion), unless it reopened meanwhile.
      let cancelled = false;
      Promise.all(dialog.getAnimations?.({ subtree: true }).map((animation) => animation.finished) ?? [])
        .catch(() => undefined)
        .then(() => !cancelled && setShown(false));
      return () => {
        cancelled = true;
      };
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={placement === 'center' ? 'sheet sheet--center' : 'sheet'}
      aria-labelledby={headingId}
      onClose={onClose}
      // The dialog itself is only hit outside the panel: on the dimmed backdrop.
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="sheet__panel">
        <div className="sheet__head">
          <div>
            <h2 id={headingId} className="sheet__title">
              {title}
            </h2>
            {description && <p className="sheet__description">{description}</p>}
          </div>
          <button type="button" className="sheet__close" aria-label={t.common.close} onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="sheet__body">{shown && <Fragment key={opening}>{children}</Fragment>}</div>
      </div>
    </dialog>
  );
}

/**
 * A page's "add new" panel, open while the address has ?new=1, so a link from
 * elsewhere (Overview, Ctrl K, the day checklist) can open it straight away.
 */
export function useNewSheet(value = '1'): [boolean, (open: boolean) => void] {
  const [params, setParams] = useSearchParams();
  const open = params.get('new') === value;
  const setOpen = (next: boolean) =>
    setParams((current) => {
      const updated = new URLSearchParams(current);
      if (next) updated.set('new', value);
      else updated.delete('new');
      return updated;
    });
  return [open, setOpen];
}
