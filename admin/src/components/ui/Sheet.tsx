import { X } from '@phosphor-icons/react';
import { Fragment, type KeyboardEvent, type ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { useT } from '../../i18n/useT';
import { touchPhone } from '../../utils/touchPhone';
import { LeaveGuardContext, SheetWorkContext } from './leaveGuardContext';
import { Tooltip } from './Tooltip';
import { useSwipeToDismiss } from './useSwipeToDismiss';

/** Fields that bring up the on-screen keyboard. */
const TYPED = 'textarea, input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=file], [type=range], [type=color])';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /** 'side' (the default, kept for its old name): a form on a card that grows out of the key that opened it.
   *  'center': a short yes-or-no question in the middle of the screen. */
  placement?: 'side' | 'center';
  /** Centred, for a list to search or pick from: wider, and one steady height while the list changes. */
  wide?: boolean;
  /** Ask "Leave without saving?" before typed work is closed away (Esc, a tap outside, the close key,
   *  pulling it down, Back). On by default for a form card; off for centred questions and pickers. */
  guard?: boolean;
  children: ReactNode;
}

/**
 * A form on a raised card over the dimmed page, for a form that would
 * otherwise sit in the middle of a list page. On a computer the card grows out
 * of the key that opened it and folds back into it; on a phone it rises from
 * the bottom and can be pulled back down by its handle. Ctrl Enter saves.
 * The browser's own modal dialog keeps focus inside, closes on Esc and returns
 * focus afterwards. The form inside starts fresh each time it opens.
 * Once something is typed into it, closing it any way but its own Save asks first.
 */
export function Sheet({ open, onClose, title, description, placement = 'side', wide = false, guard, children }: SheetProps) {
  const t = useT();
  const guarded = guard ?? placement === 'side';
  const leaveGuard = useContext(LeaveGuardContext);
  // Typed into since it opened: read when closing, so no re-render per key.
  const typed = useRef(false);
  const markTyped = useCallback(() => {
    typed.current = true;
  }, []);
  const holdsWork = () => guarded && typed.current;
  // Back with typed work asks too (the router holds the move; see LeaveGuardHost).
  const live = useRef({ open, guarded });
  useEffect(() => {
    live.current = { open, guarded };
  });
  // A save that keeps the card open (record another sale, the next duplicate) leaves nothing unsaved:
  // a successful save anywhere while it is open starts the count again.
  const queryClient = useContext(QueryClientContext);
  useEffect(() => {
    if (!open || !queryClient) return;
    return queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'success') typed.current = false;
    });
  }, [open, queryClient]);
  const { register } = leaveGuard;
  useEffect(() => register({ kind: 'sheet', active: () => live.current.open && live.current.guarded && typed.current }), [register]);
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  });
  const asking = useRef(false);
  /** Closing by hand: straight away when nothing was typed, else only once "Leave" is the answer. */
  const requestClose = () => {
    if (!holdsWork()) return onClose();
    if (asking.current) return;
    asking.current = true;
    void leaveGuard.ask().then((leave) => {
      asking.current = false;
      if (leave) latestClose.current();
    });
  };
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
  // The key that opened the card, so it can grow out of it and fold back in.
  const trigger = useRef<HTMLElement | null>(null);
  // On a touch screen the card can be pulled back down by its head.
  useSwipeToDismiss(ref, {
    side: 'bottom',
    handle: '.sheet__head',
    closed: 'translateY(100%)',
    onDismiss: () => {
      // With typed work the card springs back up while the question is asked.
      if (holdsWork()) ref.current?.style.removeProperty('transform');
      requestClose();
    },
    enabled: open && placement === 'side',
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      typed.current = false;
      const active = document.activeElement;
      trigger.current = active instanceof HTMLElement && active !== document.body ? active : null;
      growFrom(dialog, trigger.current);
      dialog.showModal?.();
      // Start in the form's first field, ready to type or scan, not on the close button;
      // on a phone not in a text field, so the keyboard doesn't jump up before the card is read.
      const first = dialog.querySelector<HTMLElement>('.sheet__body :is(input, select, textarea, [data-autofocus]):not([disabled])');
      if (!(touchPhone() && first?.matches(TYPED))) first?.focus();
    }
    if (!open) {
      // Esc closes the dialog itself before this runs. Fold back into the key
      // if it is still on screen, else shrink away in the middle.
      growFrom(dialog, trigger.current);
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
      className={placement === 'center' ? (wide ? 'sheet sheet--center sheet--wide' : 'sheet sheet--center') : 'sheet sheet--card'}
      aria-labelledby={headingId}
      onClose={() => {
        // A browser that wouldn't let Esc (or a phone's Back) be held closed the card with work in it:
        // open it again, form and all, and ask. Leave (or the form's own Save) closes it for real.
        const dialog = ref.current;
        if (live.current.open && holdsWork() && dialog && !dialog.open) {
          dialog.showModal?.();
          requestClose();
          return;
        }
        onClose();
      }}
      // Esc (and a phone's Back on a modal): with typed work, ask instead of closing.
      onCancel={(event) => {
        if (!holdsWork()) return;
        event.preventDefault();
        requestClose();
      }}
      onKeyDown={saveOnCtrlEnter}
      // The dialog itself is only hit outside the panel: on the dimmed backdrop.
      onClick={(event) => event.target === event.currentTarget && requestClose()}
    >
      <div className="sheet__panel">
        <div className="sheet__head">
          <span className="sheet__grab" aria-hidden="true" />
          <div>
            <h2 id={headingId} className="sheet__title">
              {title}
            </h2>
            {description && <p className="sheet__description">{description}</p>}
          </div>
          <Tooltip label={t.common.close} side="bottom">
            <button type="button" className="sheet__close" aria-label={t.common.close} onClick={requestClose}>
              <X size={20} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
        <div className="sheet__body" onInput={markTyped} onChange={markTyped}>
          <SheetWorkContext.Provider value={markTyped}>{shown && <Fragment key={opening}>{children}</Fragment>}</SheetWorkContext.Provider>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Points the card's closed state at the middle of the key that opened it
 * (--from-x/--from-y from the screen's middle, where the card sits), so it
 * grows out of the key and folds back into it. Opened from a link (?new=1)
 * or with the key gone or off screen, it grows from the middle instead.
 */
function growFrom(dialog: HTMLDialogElement, key: HTMLElement | null) {
  const box = key?.isConnected ? key.getBoundingClientRect() : null;
  const visible = box && box.width > 0 && box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth;
  if (box && visible) {
    dialog.style.setProperty('--from-x', `${Math.round(box.left + box.width / 2 - window.innerWidth / 2)}px`);
    dialog.style.setProperty('--from-y', `${Math.round(box.top + box.height / 2 - window.innerHeight / 2)}px`);
  } else {
    dialog.style.removeProperty('--from-x');
    dialog.style.removeProperty('--from-y');
  }
}

/** Ctrl Enter (Cmd Enter on a Mac) saves the form you are in, as its Save key would. */
function saveOnCtrlEnter(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.defaultPrevented) return;
  const body = event.currentTarget.querySelector('.sheet__body');
  const target = event.target instanceof Element ? event.target : null;
  const forms = body?.querySelectorAll('form') ?? [];
  const form = target?.closest('form') ?? (forms.length === 1 ? forms[0] : null);
  if (!form || !body?.contains(form)) return;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!submit || submit.disabled) return;
  event.preventDefault();
  form.requestSubmit(submit);
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
