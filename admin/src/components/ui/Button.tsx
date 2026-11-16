import { CircleNotch, type Icon } from '@phosphor-icons/react';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Link } from 'react-router';
import { buttonClass, type ButtonVariant } from './buttonClass';
import { Tooltip } from './Tooltip';

interface Look {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  /** A line icon shown before the label (or alone, with an aria-label). */
  icon?: Icon;
  /** The key that does the same, shown faintly after the label ("F12", "Ctrl S"). */
  shortcut?: string;
  children?: ReactNode;
}

function Contents({ icon: IconComponent, children, size, loading, shortcut }: Look & { loading?: boolean }) {
  const iconSize = size === 'sm' ? 14 : 16;
  const spinner = <CircleNotch size={iconSize} weight="bold" className="button__spinner" aria-hidden="true" />;
  // With an icon, the spinner takes its place. Without one, the label stays
  // (hidden) to hold the width and the spinner sits in the middle.
  const label = loading && !IconComponent ? <span className="button__label">{children}</span> : children;
  return (
    <>
      {loading ? spinner : IconComponent && <IconComponent size={iconSize} weight="bold" aria-hidden="true" />}
      {label}
      {shortcut && children !== undefined && (
        <span className="button__shortcut" aria-hidden="true">
          {shortcut}
        </span>
      )}
    </>
  );
}

type ButtonProps = Look &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    wide?: boolean;
    ref?: Ref<HTMLButtonElement>;
    /** While its action runs: a spinner takes the icon's place, the label and width stay, and it can't be pressed again. */
    loading?: boolean;
  };

/** Primary for the one main action, secondary for the rest, ghost for quiet ones, danger to destroy. */
export function Button({ variant, size, icon, shortcut, wide, loading, className, type = 'button', children, disabled, ...rest }: ButtonProps) {
  const iconOnly = Boolean(icon) && children === undefined;
  const key = (
    <button
      type={type}
      className={[buttonClass({ variant, size, iconOnly, wide }), loading && !icon && 'button--busy-label', className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-keyshortcuts={shortcut?.replace(/ /g, '+')}
      {...rest}
    >
      <Contents icon={icon} size={size} loading={loading} shortcut={shortcut}>
        {children}
      </Contents>
    </button>
  );
  // A key that shows only an icon shows its name on hover and focus.
  const name = rest['aria-label'];
  return iconOnly && name ? <Tooltip label={name}>{key}</Tooltip> : key;
}

type ButtonLinkProps = Look & AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

/** A link that looks like a button, for actions that open another page. */
export function ButtonLink({ variant, size, icon, shortcut, to, className, children, ...rest }: ButtonLinkProps) {
  const iconOnly = Boolean(icon) && children === undefined;
  const link = (
    <Link to={to} className={[buttonClass({ variant, size, iconOnly }), className].filter(Boolean).join(' ')} aria-keyshortcuts={shortcut?.replace(/ /g, '+')} {...rest}>
      <Contents icon={icon} size={size} shortcut={shortcut}>
        {children}
      </Contents>
    </Link>
  );
  const name = rest['aria-label'];
  return iconOnly && name ? <Tooltip label={name}>{link}</Tooltip> : link;
}
