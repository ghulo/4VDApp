import { CaretDown, Check, type Icon } from '@phosphor-icons/react';
import { Fragment, type KeyboardEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from './Button';
import type { ButtonVariant } from './buttonClass';
import { Tooltip } from './Tooltip';

export interface MenuItem {
  label: string;
  icon?: Icon;
  /** The key that does the same, shown at the end of the line. */
  shortcut?: string;
  /** One choice among several (e.g. which business is open): a tick when on, read out as checked. */
  checked?: boolean;
  /** A line above this item, where a new group starts. */
  divider?: boolean;
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
  /** A face that already shows its words needs no tooltip repeating them. */
  tooltip?: boolean;
  /** Shown above the items, not chosen (e.g. who you are). */
  heading?: ReactNode;
  /** Small print under the items, not chosen (e.g. "Runs on 4VD"). */
  footnote?: ReactNode;
}

/** How close to the screen's left edge the list may come before it flips to hang from the key's left edge. */
const EDGE = 8;

/**
 * A key that opens a short list of related actions, like the downloads of a
 * page. Arrow keys move through the list, Esc closes it and returns to the key.
 */
export function MenuButton({ label, icon, items, variant = 'ghost', size = 'sm', loading, face, faceClassName, tooltip = true, heading, footnote }: MenuButtonProps) {
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
  const menuRef = useRef<HTMLUListElement>(null);

  // The list hangs from the key's right edge; a key near the left of a phone
  // would push it off screen, so it then hangs from the left edge instead.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return;
    delete menu.dataset.align;
    if (menu.getBoundingClientRect().left < EDGE) menu.dataset.align = 'start';
  }, [open]);

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
      {face && !tooltip ? (
        <button ref={keyRef} type="button" className={faceClassName} {...keyProps}>
          {face}
        </button>
      ) : face ? (
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
      {/* Kept in the page while shut, so it can close the way it opened. */}
      <ul ref={menuRef} id={menuId} hidden={!open} role="menu" aria-label={label} className="menu" onKeyDown={onMenuKey}>
        {heading && (
          // A menu may only hold menu items, so the heading is a sighted cue only (callers repeat it elsewhere).
          <li role="none" aria-hidden="true" className="menu__heading">
            {heading}
          </li>
        )}
        {items.map((item, index) => {
          const ItemIcon = item.icon;
          return (
            <Fragment key={item.label}>
            {item.divider && <li role="separator" className="menu__divider" />}
            <li role="none">
              <button
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={item.checked}
                aria-keyshortcuts={item.shortcut}
                tabIndex={-1}
                className="menu__item"
                onClick={() => {
                  close();
                  item.onSelect();
                }}
              >
                {ItemIcon && <ItemIcon size={16} aria-hidden="true" />}
                <span className="menu__label">{item.label}</span>
                {item.shortcut && (
                  <kbd className="menu__shortcut" aria-hidden="true">
                    {item.shortcut}
                  </kbd>
                )}
                {item.checked && <Check className="menu__check" size={16} weight="bold" aria-hidden="true" />}
              </button>
            </li>
            </Fragment>
          );
        })}
        {footnote && (
          // Like the heading: a sighted cue only, said again where it matters (the sign-in page).
          <li role="none" aria-hidden="true" className="menu__footnote">
            {footnote}
          </li>
        )}
      </ul>
    </div>
  );
}
