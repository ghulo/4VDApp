import { X } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { useT } from '../../i18n/useT';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

/**
 * A panel that slides in from the right over a dimmed page, for a form that
 * would otherwise sit in the middle of a list page. The browser's own modal
 * dialog keeps focus inside, closes on Esc and returns focus afterwards. The
 * form inside starts fresh each time the panel opens.
 */
export function Sheet({ open, onClose, title, description, children }: SheetProps) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal?.();
      // Start in the form's first field, ready to type or scan, not on the close button.
      dialog.querySelector<HTMLElement>('.sheet__body :is(input, select, textarea):not([disabled])')?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
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
        <div className="sheet__body">{open && children}</div>
      </div>
    </dialog>
  );
}

/**
 * A page's "add new" panel, open while the address has ?new=1, so a link from
 * elsewhere (Overview, Ctrl K, the day checklist) can open it straight away.
 */
export function useNewSheet(): [boolean, (open: boolean) => void] {
  const [params, setParams] = useSearchParams();
  const open = params.get('new') === '1';
  const setOpen = (next: boolean) =>
    setParams((current) => {
      const updated = new URLSearchParams(current);
      if (next) updated.set('new', '1');
      else updated.delete('new');
      return updated;
    });
  return [open, setOpen];
}
