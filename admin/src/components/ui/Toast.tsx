import { CheckCircle, Info, WarningCircle, X } from '@phosphor-icons/react';
import { createContext, type CSSProperties, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/useT';
import { SuccessCheck } from './Motion';
import { Tooltip } from './Tooltip';
import { useSwipeToDismiss } from './useSwipeToDismiss';

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
  /** Fading out; gone from the list a moment later. */
  leaving?: boolean;
}

/** How long a message stays; one with a follow-up stays longer. While the pointer or focus is on the stack, every clock stops and later carries on from where it was. */
const STAY_MS = 5000;
const STAY_WITH_ACTION_MS = 9000;
/** Older ones go when a fourth arrives. */
const MOST = 3;
/** How long a leaving toast stays in the list: its fade out (--dur-medium × --exit, motion.css), a timer so it also goes under Motion: Off. */
const LEAVE_MS = 160;

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
    setToasts((list) => [...list.filter((one) => !one.leaving), { ...toast, id }].slice(-MOST));
  }, []);
  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)));
    window.setTimeout(() => setToasts((list) => list.filter((toast) => toast.id !== id)), LEAVE_MS);
  }, []);
  const staying = toasts.filter((toast) => !toast.leaving);
  // Pointing at the stack or tabbing into it stops every clock, not just the one under the pointer.
  const [pointed, setPointed] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = pointed || focused;

  return (
    <ToastContext.Provider value={show}>
      {children}
      <section className="toasts" aria-label={t.kit.notifications}>
        <ol
          className="toasts__list"
          aria-live="polite"
          data-paused={paused || undefined}
          onPointerEnter={() => setPointed(true)}
          onPointerLeave={() => setPointed(false)}
          onFocus={() => setFocused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
          }}
        >
          {toasts.map((toast) => (
            // Depth: how many newer toasts sit in front of this one (0 = the front one).
            <ToastItem key={toast.id} toast={toast} depth={toast.leaving ? 0 : staying.length - 1 - staying.indexOf(toast)} paused={paused} onDismiss={dismiss} />
          ))}
        </ol>
      </section>
    </ToastContext.Provider>
  );
}

const ICONS = { ok: CheckCircle, info: Info, danger: WarningCircle };

const depthStyle = (depth: number, stay: number) => ({ '--depth': depth, '--stay': `${stay}ms` }) as CSSProperties;

function ToastItem({ toast, depth, paused, onDismiss: dismissById }: { toast: ShownToast; depth: number; paused: boolean; onDismiss: (id: number) => void }) {
  const t = useT();
  const tone = toast.tone ?? 'ok';
  const ToneIcon = ICONS[tone];
  const stay = toast.action ? STAY_WITH_ACTION_MS : STAY_MS;
  const left = useRef(stay);
  const onDismiss = useCallback(() => dismissById(toast.id), [dismissById, toast.id]);
  // On a touch screen a toast can be flicked away sideways (touch shows them in a column, never stacked).
  const ref = useRef<HTMLLIElement>(null);
  useSwipeToDismiss(ref, { side: 'right', closed: 'translateX(110%)', onDismiss, enabled: !toast.leaving });

  // The clock runs only while the stack isn't paused, and keeps the time already used.
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(onDismiss, left.current);
    return () => {
      window.clearTimeout(timer);
      left.current = Math.max(0, left.current - (Date.now() - started));
    };
  }, [paused, onDismiss]);

  return (
    <li
      ref={ref}
      className={`toast toast--${tone}`}
      style={depthStyle(depth, stay)}
      data-behind={depth > 0 || undefined}
      data-leaving={toast.leaving || undefined}
      role={tone === 'danger' ? 'alert' : undefined}
    >
      {tone === 'ok' ? <SuccessCheck className="toast__icon" size={20} /> : <ToneIcon className="toast__icon" size={20} weight="fill" aria-hidden="true" />}
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
      {/* With an Undo, a hairline shows how long is left to press it. */}
      {toast.action && <span className="toast__time" aria-hidden="true" />}
    </li>
  );
}
