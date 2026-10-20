import { CheckCircle, Info, WarningCircle, X } from '@phosphor-icons/react';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/useT';
import { Tooltip } from './Tooltip';

export type ToastTone = 'ok' | 'info' | 'danger';

export interface ToastInput {
  /** What happened, in a few words: "Bill saved". */
  title: string;
  /** One more line when it helps: "Stock went up for 12 products." */
  detail?: string;
  tone?: ToastTone;
  /** One quick follow-up, like Undo or Open. */
  action?: { label: string; onClick: () => void };
}

interface ShownToast extends ToastInput {
  id: number;
}

/** How long a message stays; one with a follow-up stays longer, and none goes while the pointer or focus is on it. */
const STAY_MS = 5000;
const STAY_WITH_ACTION_MS = 9000;
/** Older ones go when a fourth arrives. */
const MOST = 3;

const ToastContext = createContext<(toast: ToastInput) => void>(() => undefined);

/** Shows a short message in the corner after something was done: `const toast = useToast(); toast({ title })`. */
export const useToast = () => useContext(ToastContext);

/**
 * Short messages after an action ("Bill saved", "Printed"), stacked in the
 * bottom corner (bottom middle on phones), read out by screen readers and
 * gone after a few seconds. Problems the person must fix stay on the page,
 * next to the thing to fix, not here.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [toasts, setToasts] = useState<ShownToast[]>([]);
  const next = useRef(1);
  const show = useCallback((toast: ToastInput) => {
    const id = next.current++;
    setToasts((list) => [...list, { ...toast, id }].slice(-MOST));
  }, []);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <section className="toasts" aria-label={t.kit.notifications}>
        <ol className="toasts__list" aria-live="polite">
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </ol>
      </section>
    </ToastContext.Provider>
  );
}

const ICONS = { ok: CheckCircle, info: Info, danger: WarningCircle };

function ToastItem({ toast, onDismiss: dismissById }: { toast: ShownToast; onDismiss: (id: number) => void }) {
  const t = useT();
  const tone = toast.tone ?? 'ok';
  const ToneIcon = ICONS[tone];
  const [held, setHeld] = useState(false);
  const onDismiss = useCallback(() => dismissById(toast.id), [dismissById, toast.id]);

  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(onDismiss, toast.action ? STAY_WITH_ACTION_MS : STAY_MS);
    return () => window.clearTimeout(timer);
  }, [held, onDismiss, toast.action]);

  return (
    <li
      className={`toast toast--${tone}`}
      role={tone === 'danger' ? 'alert' : undefined}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <ToneIcon className="toast__icon" size={20} weight="fill" aria-hidden="true" />
      <div className="toast__words">
        <p className="toast__title">{toast.title}</p>
        {toast.detail && <p className="toast__detail">{toast.detail}</p>}
      </div>
      {toast.action && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            toast.action!.onClick();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <Tooltip label={t.kit.dismiss}>
        <button type="button" className="toast__close" aria-label={t.kit.dismiss} onClick={onDismiss}>
          <X size={14} weight="bold" aria-hidden="true" />
        </button>
      </Tooltip>
    </li>
  );
}
