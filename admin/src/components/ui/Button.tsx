import type { Icon } from '@phosphor-icons/react';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Look {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  /** A line icon shown before the label (or alone, with an aria-label). */
  icon?: Icon;
  children?: ReactNode;
}

/** The class list for anything that should look like a button. */
export function buttonClass({
  variant = 'secondary',
  size = 'md',
  iconOnly = false,
  wide = false,
}: { variant?: ButtonVariant; size?: 'md' | 'sm'; iconOnly?: boolean; wide?: boolean } = {}): string {
  return ['button', `button--${variant}`, size === 'sm' && 'button--sm', iconOnly && 'button--icon', wide && 'button--wide']
    .filter(Boolean)
    .join(' ');
}

function Contents({ icon: IconComponent, children, size }: Look) {
  return (
    <>
      {IconComponent && <IconComponent size={size === 'sm' ? 14 : 16} weight="bold" aria-hidden="true" />}
      {children}
    </>
  );
}

type ButtonProps = Look & ButtonHTMLAttributes<HTMLButtonElement> & { wide?: boolean };

/** Primary for the one main action, secondary for the rest, ghost for quiet ones, danger to destroy. */
export function Button({ variant, size, icon, wide, className, type = 'button', children, ...rest }: ButtonProps) {
  const iconOnly = Boolean(icon) && children === undefined;
  return (
    <button
      type={type}
      className={[buttonClass({ variant, size, iconOnly, wide }), className].filter(Boolean).join(' ')}
      {...rest}
    >
      <Contents icon={icon} size={size}>
        {children}
      </Contents>
    </button>
  );
}

type ButtonLinkProps = Look & AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

/** A link that looks like a button, for actions that open another page. */
export function ButtonLink({ variant, size, icon, to, className, children, ...rest }: ButtonLinkProps) {
  const iconOnly = Boolean(icon) && children === undefined;
  return (
    <Link to={to} className={[buttonClass({ variant, size, iconOnly }), className].filter(Boolean).join(' ')} {...rest}>
      <Contents icon={icon} size={size}>
        {children}
      </Contents>
    </Link>
  );
}
