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
  children?: ReactNode;
}

function Contents({ icon: IconComponent, children, size, loading }: Look & { loading?: boolean }) {
  const iconSize = size === 'sm' ? 14 : 16;
  return (
    <>
      {loading ? (
        <CircleNotch size={iconSize} weight="bold" className="button__spinner" aria-hidden="true" />
      ) : (
        IconComponent && <IconComponent size={iconSize} weight="bold" aria-hidden="true" />
      )}
      {children}
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
export function Button({ variant, size, icon, wide, loading, className, type = 'button', children, disabled, ...rest }: ButtonProps) {
  const iconOnly = Boolean(icon) && children === undefined;
  const key = (
    <button
      type={type}
      className={[buttonClass({ variant, size, iconOnly, wide }), className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <Contents icon={icon} size={size} loading={loading}>
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
export function ButtonLink({ variant, size, icon, to, className, children, ...rest }: ButtonLinkProps) {
  const iconOnly = Boolean(icon) && children === undefined;
  const link = (
    <Link to={to} className={[buttonClass({ variant, size, iconOnly }), className].filter(Boolean).join(' ')} {...rest}>
      <Contents icon={icon} size={size}>
        {children}
      </Contents>
    </Link>
  );
  const name = rest['aria-label'];
  return iconOnly && name ? <Tooltip label={name}>{link}</Tooltip> : link;
}
