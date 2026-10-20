import { type Icon } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Button } from './Button';
import type { ButtonVariant } from './buttonClass';
import { type Align, type Side, setPopover, useFloating } from './floating';

interface PopoverProps {
  /** The key's words (or its name, when it shows only an icon). */
  label: string;
  icon?: Icon;
  /** Show only the icon; the label becomes its name and tooltip. */
  iconOnly?: boolean;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  /** A heading inside the panel, when it says more than the key. */
  title?: string;
  side?: Side;
  align?: Align;
  /** The panel's contents; `close` puts it away (after a choice, say). */
  children: ReactNode | ((close: () => void) => ReactNode);
}

/**
 * A small panel that opens from a key and holds a few controls or a short
 * explanation: filters, a quick edit, "what does this mean". Not for a
 * whole form (that is a Sheet) or a list of actions (MenuButton). Esc or a
 * click outside closes it and the key gets focus back.
 */
export function Popover({ label, icon, iconOnly, variant = 'secondary', size = 'sm', title, side = 'bottom', align = 'start', children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const headingId = useId();
  const keyRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFloating(keyRef, panelRef, open, { side, align });

  useEffect(() => {
    const panel = panelRef.current;
    setPopover(panel, open);
    if (!open || !panel) return;
    panel.querySelector<HTMLElement>('input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])')?.focus();
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.contains(target) && !keyRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      keyRef.current?.focus();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    keyRef.current?.focus();
  };

  return (
    <>
      <Button
        ref={keyRef}
        variant={variant}
        size={size}
        icon={icon}
        aria-label={iconOnly ? label : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        {iconOnly ? undefined : label}
      </Button>
      <div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-labelledby={title ? headingId : undefined}
        aria-label={title ? undefined : label}
        popover="manual"
        className="popover"
        // Tabbing out of the panel puts it away, like a click outside.
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null;
          if (next && !panelRef.current?.contains(next) && !keyRef.current?.contains(next)) setOpen(false);
        }}
      >
        {title && (
          <h3 id={headingId} className="popover__title">
            {title}
          </h3>
        )}
        {open && (typeof children === 'function' ? children(close) : children)}
      </div>
    </>
  );
}
