import { CaretDown, type Icon } from '@phosphor-icons/react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Button } from './Button';
import type { ButtonVariant } from './buttonClass';
import { Tooltip } from './Tooltip';

export interface MenuItem {
  label: string;
  icon?: Icon;
  onSelect: () => void;
}

interface MenuButtonProps {
  label: string;
  icon?: Icon;
  items: MenuItem[];
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  /** While the chosen item runs: the key shows a spinner and stays shut. */
  loading?: boolean;
  /** Draws the key as this instead of a button with the label (e.g. your avatar); the label then names it for screen readers. */
  face?: ReactNode;
  faceClassName?: string;
}

/**
 * A key that opens a short list of related actions, like the downloads of a
 * page. Arrow keys move through the list, Esc closes it and returns to the key.
 */
export function MenuButton({ label, icon, items, variant = 'ghost', size = 'sm', loading, face, faceClassName }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const keyRef = useRef<HTMLButtonElement>(null);
  const keyProps = {
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: () => setOpen((was) => !was),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' && !open) {
        event.preventDefault();
        setOpen(true);
      }
    },
  };
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const away = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const close = () => {
    setOpen(false);
    keyRef.current?.focus();
  };

  function onMenuKey(event: KeyboardEvent) {
    const current = itemRefs.current.findIndex((item) => item === document.activeElement);
    const move = (to: number) => itemRefs.current[(to + items.length) % items.length]?.focus();
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(current + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(current - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      move(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      move(items.length - 1);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div className="menu-button" ref={rootRef}>
      {face ? (
        <Tooltip label={label} side="bottom">
          <button ref={keyRef} type="button" className={faceClassName} aria-label={label} {...keyProps}>
            {face}
          </button>
        </Tooltip>
      ) : (
        <Button ref={keyRef} variant={variant} size={size} icon={icon} loading={loading} {...keyProps}>
          {label}
          <CaretDown size={12} weight="bold" aria-hidden="true" />
        </Button>
      )}
      {open && (
        <ul id={menuId} role="menu" aria-label={label} className="menu" onKeyDown={onMenuKey}>
          {items.map((item, index) => {
            const ItemIcon = item.icon;
            return (
              <li key={item.label} role="none">
                <button
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="menu__item"
                  onClick={() => {
                    close();
                    item.onSelect();
                  }}
                >
                  {ItemIcon && <ItemIcon size={16} aria-hidden="true" />}
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
