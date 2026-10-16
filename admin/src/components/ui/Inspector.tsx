import { X } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { useT } from '../../i18n/useT';
import { Button } from './Button';
import { Sheet } from './Sheet';

/** Wide enough to keep a record open beside its list and still read the list's columns. */
const DOCKED = '(min-width: 1440px)';

function subscribe(onChange: () => void) {
  const query = window.matchMedia(DOCKED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** True on screens wide enough for a list and one record side by side. */
export function useDocked(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DOCKED).matches,
    () => false,
  );
}

interface InspectorProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

/**
 * One record opened from a list. On a wide screen it docks beside the list, so
 * you can read it and keep scanning rows; on smaller screens it is a Sheet.
 * Put it inside `InspectorLayout` next to the list.
 */
export function Inspector({ open, onClose, title, description, children }: InspectorProps) {
  const docked = useDocked();
  if (!docked) {
    return (
      <Sheet open={open} onClose={onClose} title={title} description={description}>
        {children}
      </Sheet>
    );
  }
  return open ? (
    <DockedPanel onClose={onClose} title={title} description={description}>
      {children}
    </DockedPanel>
  ) : null;
}

function DockedPanel({ onClose, title, description, children }: Omit<InspectorProps, 'open'>) {
  const t = useT();
  const headingId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Where focus was before the record opened (the row's key), to return to on close.
  const triggerRef = useRef<Element | null>(null);
  // Each record that opens is announced and starts at its heading, like a page would.
  useEffect(() => {
    if (!panelRef.current?.contains(document.activeElement)) triggerRef.current = document.activeElement;
    headingRef.current?.focus({ preventScroll: true });
  }, [title]);

  const close = () => {
    const trigger = triggerRef.current;
    onClose();
    if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
  };

  return (
    <aside
      ref={panelRef}
      className="inspector"
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="inspector__head">
        <div>
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="inspector__title">
            {title}
          </h2>
          {description && <p className="inspector__description">{description}</p>}
        </div>
        <Button variant="ghost" size="sm" icon={X} aria-label={t.common.close} onClick={close} />
      </div>
      <div className="inspector__body">{children}</div>
    </aside>
  );
}

/** A list with room for the record opened from it at its side. */
export function InspectorLayout({ open, children }: { open: boolean; children: ReactNode }) {
  const docked = useDocked();
  return <div className={open && docked ? 'inspector-layout inspector-layout--open' : 'inspector-layout'}>{children}</div>;
}
