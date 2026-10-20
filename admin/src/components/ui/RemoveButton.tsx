import type { Icon } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../i18n/useT';
import { Button } from './Button';
import type { ButtonVariant } from './buttonClass';

interface Props {
  /** What the button says before it is pressed ("Remove"). */
  children?: ReactNode;
  /** The second, red button that really does it ("Yes, remove"). */
  confirm: ReactNode;
  onConfirm: () => void;
  pending?: boolean;
  disabled?: boolean;
  size?: 'md' | 'sm';
  variant?: ButtonVariant;
  icon?: Icon;
  'aria-label'?: string;
}

/** A remove that asks once: the first press shows "Yes, remove" and Cancel in its place. */
export function RemoveButton({ children, confirm, onConfirm, pending, disabled, size = 'sm', variant = 'danger-text', icon, 'aria-label': ariaLabel }: Props) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const yes = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (asking) yes.current?.focus();
  }, [asking]);

  if (!asking) {
    return (
      <Button size={size} variant={variant} icon={icon} aria-label={ariaLabel} disabled={disabled || pending} onClick={() => setAsking(true)}>
        {children}
      </Button>
    );
  }
  return (
    <span className="inline-confirm" onKeyDown={(event) => event.key === 'Escape' && setAsking(false)}>
      <Button
        ref={yes}
        size={size}
        variant="danger"
        loading={pending}
        onClick={() => {
          onConfirm();
          setAsking(false);
        }}
      >
        {confirm}
      </Button>
      <Button size={size} variant="ghost" onClick={() => setAsking(false)}>
        {t.common.cancel}
      </Button>
    </span>
  );
}
